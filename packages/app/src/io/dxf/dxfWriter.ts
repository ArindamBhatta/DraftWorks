// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Writes a `DxfDrawing` as ASCII DXF.
 *
 * The output is AC1015 (AutoCAD 2000), which is the oldest revision that still has
 * everything a DraftWorks drawing can contain - ELLIPSE, MTEXT, LWPOLYLINE and 24-bit
 * colour all arrived in R13/R2000, and none of them exist in R12 - while staying old
 * enough that every DXF reader in circulation accepts it.
 *
 * R2000 is stricter than R12 about structure: every entity and table record needs a
 * unique handle, an owner, and the right `100` subclass markers, and the LAYER table
 * needs a plot style to point at. That is why this file emits a full set of tables and a
 * small OBJECTS section rather than only the parts that carry our geometry - a file
 * missing them opens in lenient viewers but is rejected by AutoCAD itself.
 */

import {
    DXF_LINETYPE_CONTINUOUS,
    type DxfDrawing,
    type DxfEntity,
    type DxfLayerRecord,
    type DxfVec,
    dxfVec,
    ocsToWorld,
    rgbToAci,
} from "./dxfModel";

/**
 * DXF reals: fixed notation only. Exponent notation is legal in the specification but
 * several readers in the wild mis-parse it, and drawing coordinates never need it.
 */
function real(value: number): string {
    if (!Number.isFinite(value)) return "0.0";

    // toFixed gives up and returns exponent notation at 1e21 and above, which would put an
    // unparseable value in the file; toLocaleString keeps writing digits.
    const fixed =
        Math.abs(value) >= 1e21
            ? value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 9 })
            : value.toFixed(9);

    if (!fixed.includes(".")) return `${fixed}.0`;
    const trimmed = fixed.replace(/(\.\d*?)0+$/, "$1");
    return trimmed.endsWith(".") ? `${trimmed}0` : trimmed;
}

class TagWriter {
    private readonly lines: string[] = [];

    tag(code: number, value: string | number): this {
        this.lines.push(String(code), typeof value === "number" ? String(value) : value);
        return this;
    }

    real(code: number, value: number): this {
        return this.tag(code, real(value));
    }

    /** A DXF point: the three group codes ten apart that make up one coordinate triple. */
    point(base: number, value: DxfVec): this {
        return this.real(base, value.x)
            .real(base + 10, value.y)
            .real(base + 20, value.z);
    }

    append(other: TagWriter): this {
        this.lines.push(...other.lines);
        return this;
    }

    toString(): string {
        // DXF is a line-oriented format and readers expect a trailing newline.
        return `${this.lines.join("\n")}\n`;
    }
}

/**
 * Hands out the unique handles R2000 requires. Starting above the handles AutoCAD
 * reserves for its own fixed objects keeps the file clear of them.
 */
/**
 * `*Model_Space`'s handle, fixed rather than allocated.
 *
 * AutoCAD gives the model space block record handle 1F in every file it writes, and
 * readers have been built around that. LibreDWG's DXF reader - which every DWG export
 * goes through - creates its own `*Model_Space` at 1F before parsing and merges ours into
 * it only if the handles match. Under any other handle the file ends up with two model
 * spaces, and the entities, owned by one of them, are dropped by the encoder: the export
 * succeeds and produces a DWG containing no drawing.
 *
 * Below HandleAllocator's range, so nothing else can be given it.
 */
const MODEL_SPACE_HANDLE = "1F";

class HandleAllocator {
    private next = 0x110;

    take(): string {
        const handle = this.next++;
        return handle.toString(16).toUpperCase();
    }

    /** $HANDSEED: must be greater than every handle in the file. */
    seed(): string {
        return this.next.toString(16).toUpperCase();
    }
}

/** The handles that are referenced from more than one place and so are fixed up front. */
interface Anchors {
    vportTable: string;
    ltypeTable: string;
    layerTable: string;
    styleTable: string;
    viewTable: string;
    ucsTable: string;
    appidTable: string;
    dimstyleTable: string;
    blockRecordTable: string;
    rootDictionary: string;
    groupDictionary: string;
    plotStyleDictionary: string;
    plotStylePlaceholder: string;
    modelSpace: string;
    paperSpace: string;
    /** Block name to its BLOCK_RECORD handle, which owns the block's entities. */
    blockRecords: Map<string, string>;
}

export interface DxfWriteOptions {
    /**
     * The drawing's dimension styles, written into DIMSTYLE so text and arrows plot at
     * the right size and each DIMENSION's group 3 has a record to name. Standard is
     * written whether or not it appears here, since a DXF with no dimension style is not
     * something every reader copes with.
     */
    dimensionStyles?: {
        name: string;
        textHeight: number;
        arrowSize: number;
        extensionOffset: number;
        decimals: number;
    }[];
}

export function writeDxf(drawing: DxfDrawing, options: DxfWriteOptions = {}): string {
    const handles = new HandleAllocator();
    const anchors: Anchors = {
        vportTable: handles.take(),
        ltypeTable: handles.take(),
        layerTable: handles.take(),
        styleTable: handles.take(),
        viewTable: handles.take(),
        ucsTable: handles.take(),
        appidTable: handles.take(),
        dimstyleTable: handles.take(),
        blockRecordTable: handles.take(),
        rootDictionary: handles.take(),
        groupDictionary: handles.take(),
        plotStyleDictionary: handles.take(),
        plotStylePlaceholder: handles.take(),
        modelSpace: MODEL_SPACE_HANDLE,
        paperSpace: handles.take(),
        blockRecords: new Map(),
    };
    for (const block of drawing.blocks) {
        anchors.blockRecords.set(block.name, handles.take());
    }

    // The body is built first because $HANDSEED in the header has to exceed every handle
    // the body allocated.
    const body = new TagWriter();
    writeTables(body, drawing, anchors, handles, options);
    writeBlocks(body, drawing, anchors, handles);
    writeEntities(body, drawing, anchors, handles);
    writeObjects(body, anchors);

    const out = new TagWriter();
    writeHeader(out, drawing, handles.seed());
    out.append(body);
    out.tag(0, "EOF");
    return out.toString();
}

function extents(drawing: DxfDrawing): { min: DxfVec; max: DxfVec } {
    const min = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: 0 };
    const max = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: 0 };
    const grow = (x: number, y: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        min.x = Math.min(min.x, x);
        min.y = Math.min(min.y, y);
        max.x = Math.max(max.x, x);
        max.y = Math.max(max.y, y);
    };

    for (const entity of drawing.entities) {
        switch (entity.type) {
            case "line":
                grow(entity.start.x, entity.start.y);
                grow(entity.end.x, entity.end.y);
                break;
            case "circle":
            case "arc":
                grow(entity.center.x - entity.radius, entity.center.y - entity.radius);
                grow(entity.center.x + entity.radius, entity.center.y + entity.radius);
                break;
            case "ellipse": {
                const major = Math.hypot(entity.majorAxis.x, entity.majorAxis.y, entity.majorAxis.z);
                grow(entity.center.x - major, entity.center.y - major);
                grow(entity.center.x + major, entity.center.y + major);
                break;
            }
            case "polyline":
                for (const vertex of entity.vertices) grow(vertex.x, vertex.y);
                break;
            case "spline":
                for (const p of entity.controlPoints) grow(p.x, p.y);
                break;
            case "solid":
                for (const p of entity.corners) grow(p.x, p.y);
                break;
            case "point":
                grow(entity.position.x, entity.position.y);
                break;
            case "text":
                grow(entity.position.x, entity.position.y);
                break;
            case "dimension":
                grow(entity.definitionPoint.x, entity.definitionPoint.y);
                grow(entity.textMidPoint.x, entity.textMidPoint.y);
                break;
            default:
                break;
        }
    }

    if (!Number.isFinite(min.x)) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    return { min, max };
}

function writeHeader(out: TagWriter, drawing: DxfDrawing, handSeed: string): void {
    const { min, max } = extents(drawing);
    out.tag(0, "SECTION").tag(2, "HEADER");
    out.tag(9, "$ACADVER").tag(1, "AC1015");
    out.tag(9, "$HANDSEED").tag(5, handSeed);
    out.tag(9, "$INSUNITS").tag(70, drawing.insUnits);
    out.tag(9, "$MEASUREMENT").tag(70, drawing.insUnits === 1 || drawing.insUnits === 2 ? 0 : 1);
    out.tag(9, "$LTSCALE").real(40, 1);
    out.tag(9, "$EXTMIN").point(10, min);
    out.tag(9, "$EXTMAX").point(10, max);
    out.tag(9, "$CLAYER").tag(8, drawing.layers[0]?.name ?? "0");
    out.tag(0, "ENDSEC");
}

/** Opens a table: its own handle, owner 0 (the drawing), and the record count. */
function beginTable(out: TagWriter, name: string, handle: string, count: number): void {
    out.tag(0, "TABLE").tag(2, name).tag(5, handle).tag(330, "0");
    out.tag(100, "AcDbSymbolTable").tag(70, count);
}

function beginRecord(out: TagWriter, type: string, handle: string, owner: string, subclass: string): void {
    // DIMSTYLE is the one table record whose handle is group 105 rather than 5.
    out.tag(0, type)
        .tag(type === "DIMSTYLE" ? 105 : 5, handle)
        .tag(330, owner);
    out.tag(100, "AcDbSymbolTableRecord").tag(100, subclass);
}

/** The dash patterns behind the linetype names DraftWorks maps its render styles to. */
const LINETYPE_PATTERNS: ReadonlyArray<{
    name: string;
    description: string;
    length: number;
    dashes: number[];
}> = [
    { name: DXF_LINETYPE_CONTINUOUS, description: "Solid line", length: 0, dashes: [] },
    { name: "DASHED", description: "Dashed __ __ __ __ __ __ __ __ __", length: 0.75, dashes: [0.5, -0.25] },
    {
        name: "HIDDEN",
        description: "Hidden __ __ __ __ __ __ __ __ __",
        length: 0.375,
        dashes: [0.25, -0.125],
    },
    { name: "DOT", description: "Dot . . . . . . . . . . . . . . .", length: 0.25, dashes: [0, -0.25] },
];

function writeTables(
    out: TagWriter,
    drawing: DxfDrawing,
    anchors: Anchors,
    handles: HandleAllocator,
    options: DxfWriteOptions,
): void {
    out.tag(0, "SECTION").tag(2, "TABLES");

    // VPORT. A single *Active viewport; readers that open the file into a window need one.
    beginTable(out, "VPORT", anchors.vportTable, 1);
    beginRecord(out, "VPORT", handles.take(), anchors.vportTable, "AcDbViewportTableRecord");
    out.tag(2, "*Active").tag(70, 0);
    out.real(10, 0).real(20, 0).real(11, 1).real(21, 1);
    out.real(12, 0).real(22, 0).real(13, 0).real(23, 0);
    out.real(14, 10).real(24, 10).real(15, 0).real(25, 0);
    out.real(16, 0).real(26, 0).real(36, 1);
    out.real(17, 0).real(27, 0).real(37, 0);
    out.real(40, 297).real(41, 1.5).real(42, 50).real(43, 0).real(44, 0);
    out.real(50, 0).real(51, 0);
    out.tag(71, 0).tag(72, 100).tag(73, 1).tag(74, 3).tag(75, 0).tag(76, 0).tag(77, 0).tag(78, 0);
    out.tag(0, "ENDTAB");

    // LTYPE. ByBlock and ByLayer must exist before any record can name them.
    beginTable(out, "LTYPE", anchors.ltypeTable, LINETYPE_PATTERNS.length + 2);
    for (const name of ["ByBlock", "ByLayer"]) {
        beginRecord(out, "LTYPE", handles.take(), anchors.ltypeTable, "AcDbLinetypeTableRecord");
        out.tag(2, name).tag(70, 0).tag(3, "").tag(72, 65).tag(73, 0).real(40, 0);
    }
    for (const pattern of LINETYPE_PATTERNS) {
        beginRecord(out, "LTYPE", handles.take(), anchors.ltypeTable, "AcDbLinetypeTableRecord");
        out.tag(2, pattern.name).tag(70, 0).tag(3, pattern.description);
        out.tag(72, 65).tag(73, pattern.dashes.length).real(40, pattern.length);
        for (const dash of pattern.dashes) out.real(49, dash).tag(74, 0);
    }
    out.tag(0, "ENDTAB");

    // LAYER.
    const layers = drawing.layers.length > 0 ? drawing.layers : [defaultLayer()];
    beginTable(out, "LAYER", anchors.layerTable, layers.length);
    for (const layer of layers) writeLayer(out, layer, anchors, handles);
    out.tag(0, "ENDTAB");

    // STYLE. "Standard" is the style every TEXT/MTEXT written here refers to.
    beginTable(out, "STYLE", anchors.styleTable, 1);
    beginRecord(out, "STYLE", handles.take(), anchors.styleTable, "AcDbTextStyleTableRecord");
    out.tag(2, "Standard").tag(70, 0);
    out.real(40, 0).real(41, 1).real(50, 0).tag(71, 0).real(42, 2.5);
    out.tag(3, "txt").tag(4, "");
    out.tag(0, "ENDTAB");

    // VIEW and UCS carry nothing of ours but are part of the expected table set.
    beginTable(out, "VIEW", anchors.viewTable, 0);
    out.tag(0, "ENDTAB");
    beginTable(out, "UCS", anchors.ucsTable, 0);
    out.tag(0, "ENDTAB");

    beginTable(out, "APPID", anchors.appidTable, 1);
    beginRecord(out, "APPID", handles.take(), anchors.appidTable, "AcDbRegAppTableRecord");
    out.tag(2, "ACAD").tag(70, 0);
    out.tag(0, "ENDTAB");

    // DIMSTYLE. Carries the drawing's real text/arrow sizes so dimensions plot at the
    // size they were drawn at rather than the reader's own defaults.
    const dimensionStyles = options.dimensionStyles?.length
        ? options.dimensionStyles
        : [{ name: "Standard", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.625, decimals: 2 }];
    out.tag(0, "TABLE").tag(2, "DIMSTYLE").tag(5, anchors.dimstyleTable).tag(330, "0");
    out.tag(100, "AcDbSymbolTable")
        .tag(70, dimensionStyles.length)
        .tag(100, "AcDbDimStyleTable")
        .tag(71, dimensionStyles.length);
    for (const dimension of dimensionStyles) {
        beginRecord(out, "DIMSTYLE", handles.take(), anchors.dimstyleTable, "AcDbDimStyleTableRecord");
        out.tag(2, dimension.name).tag(70, 0);
        out.real(40, 1);
        out.real(41, dimension.arrowSize);
        out.real(42, dimension.extensionOffset);
        out.real(44, 1.25);
        out.real(140, dimension.textHeight);
        out.real(141, dimension.arrowSize);
        out.real(147, 0.625);
        out.tag(271, dimension.decimals).tag(272, dimension.decimals);
    }
    out.tag(0, "ENDTAB");

    // BLOCK_RECORD. Model and paper space always exist; each drawing block adds one.
    beginTable(out, "BLOCK_RECORD", anchors.blockRecordTable, 2 + drawing.blocks.length);
    for (const [name, handle] of [
        ["*Model_Space", anchors.modelSpace],
        ["*Paper_Space", anchors.paperSpace],
        ...[...anchors.blockRecords].map(([blockName, h]) => [blockName, h] as const),
    ] as ReadonlyArray<readonly [string, string]>) {
        beginRecord(out, "BLOCK_RECORD", handle, anchors.blockRecordTable, "AcDbBlockTableRecord");
        out.tag(2, name).tag(70, 0).tag(280, 1).tag(281, 0);
    }
    out.tag(0, "ENDTAB");

    out.tag(0, "ENDSEC");
}

const defaultLayer = (): DxfLayerRecord => ({
    name: "0",
    color: 0xffffff,
    off: false,
    frozen: false,
    locked: false,
    plot: true,
    lineType: DXF_LINETYPE_CONTINUOUS,
});

function writeLayer(out: TagWriter, layer: DxfLayerRecord, anchors: Anchors, handles: HandleAllocator): void {
    beginRecord(out, "LAYER", handles.take(), anchors.layerTable, "AcDbLayerTableRecord");
    out.tag(2, layer.name);
    out.tag(70, (layer.frozen ? 1 : 0) | (layer.locked ? 4 : 0));

    const aci = layer.color === undefined ? 7 : rgbToAci(layer.color);
    // A layer that is off is recorded as a negative colour index - there is no flag for it.
    out.tag(62, layer.off ? -aci : aci);
    if (layer.color !== undefined) out.tag(420, layer.color);

    out.tag(6, layer.lineType || DXF_LINETYPE_CONTINUOUS);
    out.tag(370, layer.lineWeight ?? -3);
    out.tag(290, layer.plot ? 1 : 0);
    // Required in R2000: every layer points at a plot style, ours at the placeholder in
    // the OBJECTS section.
    out.tag(390, anchors.plotStylePlaceholder);
}

function writeBlocks(out: TagWriter, drawing: DxfDrawing, anchors: Anchors, handles: HandleAllocator): void {
    out.tag(0, "SECTION").tag(2, "BLOCKS");

    // Model and paper space are written as empty blocks; the real model-space entities
    // live in the ENTITIES section, which is where every reader looks for them.
    writeBlock(out, "*Model_Space", anchors.modelSpace, { x: 0, y: 0, z: 0 }, [], handles);
    writeBlock(out, "*Paper_Space", anchors.paperSpace, { x: 0, y: 0, z: 0 }, [], handles);

    for (const block of drawing.blocks) {
        const owner = anchors.blockRecords.get(block.name);
        if (!owner) continue;
        writeBlock(out, block.name, owner, block.basePoint, block.entities, handles);
    }

    out.tag(0, "ENDSEC");
}

function writeBlock(
    out: TagWriter,
    name: string,
    owner: string,
    basePoint: DxfVec,
    entities: DxfEntity[],
    handles: HandleAllocator,
): void {
    out.tag(0, "BLOCK").tag(5, handles.take()).tag(330, owner);
    out.tag(100, "AcDbEntity").tag(8, "0").tag(100, "AcDbBlockBegin");
    out.tag(2, name);
    // Bit 1 marks an anonymous block, which is what a dimension's picture block is.
    out.tag(70, name.startsWith("*D") ? 1 : 0);
    out.point(10, basePoint);
    out.tag(3, name).tag(1, "");

    for (const entity of entities) writeEntity(out, entity, owner, handles);

    out.tag(0, "ENDBLK").tag(5, handles.take()).tag(330, owner);
    out.tag(100, "AcDbEntity").tag(8, "0").tag(100, "AcDbBlockEnd");
}

function writeEntities(
    out: TagWriter,
    drawing: DxfDrawing,
    anchors: Anchors,
    handles: HandleAllocator,
): void {
    out.tag(0, "SECTION").tag(2, "ENTITIES");
    for (const entity of drawing.entities) writeEntity(out, entity, anchors.modelSpace, handles);
    out.tag(0, "ENDSEC");
}

/** The AcDbEntity block every entity starts with: handle, owner, layer and overrides. */
function writeEntityHeader(
    out: TagWriter,
    type: string,
    entity: DxfEntity,
    owner: string,
    handles: HandleAllocator,
): void {
    out.tag(0, type).tag(5, handles.take()).tag(330, owner);
    out.tag(100, "AcDbEntity").tag(8, entity.layer);
    if (entity.lineType) out.tag(6, entity.lineType);
    if (entity.color !== undefined) {
        // Both forms: 62 for readers that only understand the palette, 420 for the exact
        // colour. A reader that understands 420 prefers it, so nothing is lost either way.
        out.tag(62, rgbToAci(entity.color)).tag(420, entity.color);
    }
    if (entity.lineWeight !== undefined) out.tag(370, entity.lineWeight);
}

const DIMENSION_FLAGS: Record<string, number> = {
    linear: 0,
    aligned: 1,
    angular: 5,
    diameter: 3,
    radius: 4,
};

function writeEntity(out: TagWriter, entity: DxfEntity, owner: string, handles: HandleAllocator): void {
    switch (entity.type) {
        case "line":
            writeEntityHeader(out, "LINE", entity, owner, handles);
            out.tag(100, "AcDbLine").point(10, entity.start).point(11, entity.end);
            break;

        case "circle":
            writeEntityHeader(out, "CIRCLE", entity, owner, handles);
            out.tag(100, "AcDbCircle").point(10, entity.center).real(40, entity.radius);
            out.point(210, entity.normal);
            break;

        case "arc":
            writeEntityHeader(out, "ARC", entity, owner, handles);
            out.tag(100, "AcDbCircle").point(10, entity.center).real(40, entity.radius);
            out.point(210, entity.normal);
            out.tag(100, "AcDbArc").real(50, entity.startAngle).real(51, entity.endAngle);
            break;

        case "ellipse":
            writeEntityHeader(out, "ELLIPSE", entity, owner, handles);
            out.tag(100, "AcDbEllipse").point(10, entity.center).point(11, entity.majorAxis);
            out.point(210, entity.normal);
            out.real(40, entity.ratio).real(41, entity.startParam).real(42, entity.endParam);
            break;

        case "polyline":
            writeEntityHeader(out, "LWPOLYLINE", entity, owner, handles);
            out.tag(100, "AcDbPolyline").tag(90, entity.vertices.length);
            out.tag(70, entity.closed ? 1 : 0).real(43, 0);
            if (entity.elevation !== 0) out.real(38, entity.elevation);
            for (const vertex of entity.vertices) {
                out.real(10, vertex.x).real(20, vertex.y);
                if (vertex.bulge !== 0) out.real(42, vertex.bulge);
            }
            out.point(210, entity.normal);
            break;

        case "point":
            writeEntityHeader(out, "POINT", entity, owner, handles);
            out.tag(100, "AcDbPoint").point(10, entity.position);
            break;

        case "solid":
            writeEntityHeader(out, "SOLID", entity, owner, handles);
            out.tag(100, "AcDbTrace");
            out.point(10, entity.corners[0]).point(11, entity.corners[1]);
            // DXF's SOLID corner order is a bowtie: 12 and 13 are the far edge, and a
            // triangle repeats its last corner rather than leaving 13 out.
            out.point(12, entity.corners[2]).point(13, entity.corners[3]);
            break;

        case "text":
            if (entity.multiline) {
                writeEntityHeader(out, "MTEXT", entity, owner, handles);
                out.tag(100, "AcDbMText").point(10, entity.position);
                out.point(11, mtextXAxis(entity.rotation, entity.normal));
                out.real(40, entity.height).real(41, entity.boxWidth);
                // 1 = top-left attachment, matching how TextAnnotation hangs MTEXT.
                out.tag(71, 1).tag(72, 1);
                writeMTextContent(out, entity.content);
                out.tag(7, "Standard");
                out.point(210, entity.normal);
            } else {
                writeEntityHeader(out, "TEXT", entity, owner, handles);
                out.tag(100, "AcDbText").point(10, entity.position);
                out.real(40, entity.height).tag(1, escapeText(entity.content));
                out.real(50, entity.rotation).real(41, 1).real(51, 0);
                out.tag(7, "Standard").tag(71, 0).tag(72, 0);
                out.point(210, entity.normal);
                // The subclass marker repeats before the vertical justification field.
                out.tag(100, "AcDbText").tag(73, 0);
            }
            break;

        case "dimension":
            writeEntityHeader(out, "DIMENSION", entity, owner, handles);
            out.tag(100, "AcDbDimension");
            out.tag(2, entity.blockName ?? "*Model_Space");
            out.point(10, entity.definitionPoint);
            out.point(11, entity.textMidPoint);
            // Bit 32 says this block is used by exactly one dimension, which is true of
            // every block written here.
            out.tag(70, (DIMENSION_FLAGS[entity.dimensionType] ?? 0) | 32);
            out.tag(71, 5).tag(1, entity.text ? escapeText(entity.text) : "<>");
            out.tag(3, entity.styleName ?? "Standard");
            writeDimensionSubclass(out, entity);
            break;

        case "spline":
            writeEntityHeader(out, "SPLINE", entity, owner, handles);
            out.tag(100, "AcDbSpline");
            out.point(210, { x: 0, y: 0, z: 1 });
            // Bit 1 closed, 2 periodic, 8 planar - a 2D spline is always the last.
            out.tag(70, (entity.closed ? 3 : 0) | 8);
            out.tag(71, entity.degree).tag(72, entity.knots.length);
            out.tag(73, entity.controlPoints.length).tag(74, entity.fitPoints.length);
            for (const knot of entity.knots) out.real(40, knot);
            for (const weight of entity.weights) out.real(41, weight);
            for (const p of entity.controlPoints) out.point(10, p);
            for (const p of entity.fitPoints) out.point(11, p);
            break;

        case "insert":
            writeEntityHeader(out, "INSERT", entity, owner, handles);
            out.tag(100, "AcDbBlockReference").tag(2, entity.blockName);
            out.point(10, entity.position);
            out.real(41, entity.scale.x).real(42, entity.scale.y).real(43, entity.scale.z);
            out.real(50, entity.rotation);
            out.point(210, entity.normal);
            break;

        default:
            break;
    }
}

function writeDimensionSubclass(out: TagWriter, entity: DxfEntity & { type: "dimension" }): void {
    const zero = { x: 0, y: 0, z: 0 };
    switch (entity.dimensionType) {
        case "linear":
        case "aligned":
            out.tag(100, "AcDbAlignedDimension");
            out.point(13, entity.point1 ?? zero).point(14, entity.point2 ?? zero);
            if (entity.dimensionType === "linear") {
                // A rotated dimension is an aligned one plus an angle, and the subclass
                // marker has to say so.
                out.real(50, entity.rotation);
                out.tag(100, "AcDbRotatedDimension");
            }
            break;
        case "angular":
            out.tag(100, "AcDb3PointAngularDimension");
            out.point(13, entity.point1 ?? zero).point(14, entity.point2 ?? zero);
            out.point(15, entity.point3 ?? zero).point(16, entity.point4 ?? entity.definitionPoint);
            break;
        case "radius":
            out.tag(100, "AcDbRadialDimension");
            out.point(15, entity.point1 ?? zero).real(40, 0);
            break;
        case "diameter":
            out.tag(100, "AcDbDiametricDimension");
            out.point(15, entity.point1 ?? zero).real(40, 0);
            break;
        default:
            break;
    }
}

/** MTEXT carries at most 250 characters per tag: group 3 for each full chunk, 1 for the tail. */
/**
 * MTEXT's rotation as the X-axis direction vector of group 11, in world space.
 *
 * TEXT states its rotation as an angle at group 50, and MTEXT looks like it should too -
 * the specification does list a 50 for it. Nothing writes it that way: AutoCAD emits the
 * direction vector, the specification has that 50 in radians while TEXT's is in degrees,
 * and LibreDWG has no field for it at all, so a 50 on an MTEXT makes its DXF reader
 * reject the whole file - which is the reader every DWG export goes through. The vector
 * is unambiguous in a way the angle is not, so it is what gets written.
 */
function mtextXAxis(rotation: number, normal: DxfVec): DxfVec {
    const radians = (rotation * Math.PI) / 180;
    // Built in the entity's own plane, then placed in world space, because group 11 is a
    // WCS direction even though the rotation it encodes is measured in that plane.
    return ocsToWorld(dxfVec(Math.cos(radians), Math.sin(radians), 0), normal);
}

function writeMTextContent(out: TagWriter, content: string): void {
    const escaped = escapeMText(content);
    for (let i = 0; i < escaped.length - 250; i += 250) {
        out.tag(3, escaped.slice(i, i + 250));
    }
    const tailStart = Math.max(0, Math.floor(Math.max(0, escaped.length - 1) / 250) * 250);
    out.tag(1, escaped.slice(escaped.length <= 250 ? 0 : tailStart));
}

/** A literal `^` in TEXT is written `^ `, and newlines cannot be represented at all. */
function escapeText(value: string): string {
    return value.replace(/\^/g, "^ ").replace(/[\r\n]+/g, " ");
}

/** The reverse of the reader's unescapeMText: only the characters that must be escaped. */
export function escapeMText(value: string): string {
    return value.replace(/([\\{}])/g, "\\$1").replace(/\r\n|\r|\n/g, "\\P");
}

/**
 * The smallest OBJECTS section R2000 accepts: a root dictionary, the group dictionary
 * every drawing has, and a plot style dictionary holding the "Normal" placeholder that
 * each LAYER's group 390 points at.
 */
function writeObjects(out: TagWriter, anchors: Anchors): void {
    out.tag(0, "SECTION").tag(2, "OBJECTS");

    out.tag(0, "DICTIONARY").tag(5, anchors.rootDictionary).tag(330, "0");
    out.tag(100, "AcDbDictionary").tag(281, 1);
    out.tag(3, "ACAD_GROUP").tag(350, anchors.groupDictionary);
    out.tag(3, "ACAD_PLOTSTYLENAME").tag(350, anchors.plotStyleDictionary);

    out.tag(0, "DICTIONARY").tag(5, anchors.groupDictionary).tag(330, anchors.rootDictionary);
    out.tag(100, "AcDbDictionary").tag(281, 1);

    out.tag(0, "ACDBDICTIONARYWDFLT").tag(5, anchors.plotStyleDictionary);
    out.tag(330, anchors.rootDictionary);
    out.tag(100, "AcDbDictionary").tag(281, 1);
    out.tag(3, "Normal").tag(350, anchors.plotStylePlaceholder);
    out.tag(100, "AcDbDictionaryWithDefault").tag(340, anchors.plotStylePlaceholder);

    out.tag(0, "ACDBPLACEHOLDER").tag(5, anchors.plotStylePlaceholder);
    out.tag(330, anchors.plotStyleDictionary);

    out.tag(0, "ENDSEC");
}
