// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Reads ASCII DXF into a `DxfDrawing`.
 *
 * DXF is a flat stream of (group code, value) line pairs, so parsing is a matter of
 * grouping that stream by the `0` records that start each entity and knowing which code
 * means what per entity type. There is no version switch here on purpose: every release
 * from R12 to the current one uses the same codes for the entities below and only adds
 * new ones, so reading is version-tolerant as long as unknown codes are ignored - which
 * is what `collect` does.
 */

import {
    aciToRgb,
    DXF_UP,
    type DxfBlock,
    type DxfDimensionKind,
    type DxfDrawing,
    type DxfEntity,
    type DxfLayerRecord,
    type DxfPolylineVertex,
    type DxfVec,
    dxfVec,
    emptyDrawing,
    lineWeightFromDxf,
} from "./dxfModel";

export interface DxfTag {
    code: number;
    value: string;
}

/**
 * Splits the file into tags. A DXF file is strictly two lines per tag, but files that
 * have been through a text editor or a lossy transfer can lose that alignment, so a line
 * where a group code should be and isn't a number is skipped rather than desynchronising
 * everything after it.
 */
export function tokenize(text: string): DxfTag[] {
    const lines = text.split(/\r\n|\r|\n/);
    const tags: DxfTag[] = [];
    let i = 0;
    while (i + 1 < lines.length) {
        const code = Number.parseInt(lines[i].trim(), 10);
        if (Number.isNaN(code)) {
            i += 1;
            continue;
        }
        tags.push({ code, value: lines[i + 1] });
        i += 2;
    }
    return tags;
}

/** A group of tags describing one record: the `0` tag's value plus everything after it. */
interface DxfRecord {
    name: string;
    tags: DxfTag[];
}

const number = (tags: DxfTag[], code: number, fallback: number): number => {
    const tag = tags.find((t) => t.code === code);
    if (!tag) return fallback;
    const value = Number.parseFloat(tag.value.trim());
    return Number.isFinite(value) ? value : fallback;
};

const text = (tags: DxfTag[], code: number, fallback = ""): string =>
    tags.find((t) => t.code === code)?.value.trim() ?? fallback;

const has = (tags: DxfTag[], code: number): boolean => tags.some((t) => t.code === code);

/** DXF points are three consecutive decades: 10/20/30, 11/21/31, and so on. */
const point = (tags: DxfTag[], base: number, fallback = dxfVec()): DxfVec =>
    dxfVec(
        number(tags, base, fallback.x),
        number(tags, base + 10, fallback.y),
        number(tags, base + 20, fallback.z),
    );

const normalOf = (tags: DxfTag[]): DxfVec => (has(tags, 210) ? point(tags, 210, DXF_UP) : DXF_UP);

/**
 * The colour an entity or layer carries. 420 is the true 24-bit colour later releases
 * write and is preferred whenever present; 62 is the palette index every release writes,
 * and is what a file from an older application will have.
 */
const colorOf = (tags: DxfTag[]): number | undefined => {
    if (has(tags, 420)) {
        const value = number(tags, 420, -1);
        if (value >= 0) return value & 0xffffff;
    }
    const index = number(tags, 62, 256);
    // 0 is BYBLOCK and 256 is BYLAYER: neither names a colour of its own.
    if (index === 0 || index === 256) return undefined;
    return aciToRgb(Math.abs(index));
};

const commonOf = (tags: DxfTag[]) => {
    const lineType = text(tags, 6);
    const weight = has(tags, 370) ? lineWeightFromDxf(number(tags, 370, -1)) : undefined;
    const upper = lineType.toUpperCase();
    return {
        layer: text(tags, 8, "0"),
        color: colorOf(tags),
        lineType: upper === "BYLAYER" || upper === "" ? undefined : lineType,
        lineWeight: weight,
    };
};

/**
 * Walks a section's tags and yields one record per `0` tag, stopping at ENDSEC. Group
 * codes this reader does not know simply stay in `tags` and are ignored by the per-entity
 * builders, which is what keeps newer DXF revisions readable.
 */
function collect(tags: DxfTag[], start: number, stopAt: ReadonlySet<string>) {
    const records: DxfRecord[] = [];
    let current: DxfRecord | undefined;
    let i = start;
    for (; i < tags.length; i++) {
        const tag = tags[i];
        if (tag.code !== 0) {
            current?.tags.push(tag);
            continue;
        }
        const name = tag.value.trim().toUpperCase();
        if (stopAt.has(name)) break;
        current = { name, tags: [] };
        records.push(current);
    }
    return { records, end: i };
}

const SECTION_END = new Set(["ENDSEC", "EOF"]);
const TABLE_END = new Set(["ENDTAB", "ENDSEC", "EOF"]);
const BLOCK_END = new Set(["ENDBLK", "ENDSEC", "EOF"]);

const BINARY_SENTINEL = "AutoCAD Binary DXF";

export class DxfParseError extends Error {}

/**
 * Parses `content` into a drawing. Throws `DxfParseError` only for input that is not
 * ASCII DXF at all; anything that parses at all yields a drawing, with entity types it
 * has no record for listed in `unsupported` rather than failing the whole file.
 */
export function readDxf(content: string): DxfDrawing {
    if (content.startsWith(BINARY_SENTINEL)) {
        throw new DxfParseError("binary");
    }

    const tags = tokenize(content);
    if (!tags.some((t) => t.code === 0 && t.value.trim().toUpperCase() === "SECTION")) {
        throw new DxfParseError("notDxf");
    }

    const drawing = emptyDrawing();
    const unsupported = new Set<string>();

    for (let i = 0; i < tags.length; i++) {
        if (tags[i].code !== 0 || tags[i].value.trim().toUpperCase() !== "SECTION") continue;
        const name = tags[i + 1]?.code === 2 ? tags[i + 1].value.trim().toUpperCase() : "";
        switch (name) {
            case "HEADER":
                i = readHeader(tags, i + 2, drawing);
                break;
            case "TABLES":
                i = readTables(tags, i + 2, drawing);
                break;
            case "BLOCKS":
                i = readBlocks(tags, i + 2, drawing, unsupported);
                break;
            case "ENTITIES": {
                const result = collect(tags, i + 2, SECTION_END);
                drawing.entities.push(...buildEntities(result.records, unsupported));
                i = result.end;
                break;
            }
            default:
                break;
        }
    }

    drawing.unsupported = [...unsupported].sort();
    return drawing;
}

/** Header variables are `9/$NAME` followed by the value tags belonging to that name. */
function readHeader(tags: DxfTag[], start: number, drawing: DxfDrawing): number {
    let i = start;
    let variable = "";
    for (; i < tags.length; i++) {
        const tag = tags[i];
        if (tag.code === 0) break;
        if (tag.code === 9) {
            variable = tag.value.trim().toUpperCase();
            continue;
        }
        if (variable === "$INSUNITS" && tag.code === 70) {
            const value = Number.parseInt(tag.value.trim(), 10);
            if (Number.isFinite(value)) drawing.insUnits = value;
        }
    }
    return i;
}

function readTables(tags: DxfTag[], start: number, drawing: DxfDrawing): number {
    let i = start;
    for (; i < tags.length; i++) {
        const tag = tags[i];
        if (tag.code !== 0) continue;
        const name = tag.value.trim().toUpperCase();
        if (name === "ENDSEC" || name === "EOF") break;
        if (name !== "TABLE") continue;

        const tableName = tags[i + 1]?.code === 2 ? tags[i + 1].value.trim().toUpperCase() : "";
        const result = collect(tags, i + 2, TABLE_END);
        if (tableName === "LAYER") {
            for (const record of result.records) {
                if (record.name === "LAYER") drawing.layers.push(buildLayer(record.tags));
            }
        }
        i = result.end;
    }
    return i;
}

function buildLayer(tags: DxfTag[]): DxfLayerRecord {
    const flags = number(tags, 70, 0);
    const colorIndex = number(tags, 62, 7);
    const lineType = text(tags, 6, "CONTINUOUS");
    return {
        name: text(tags, 2, "0"),
        color: colorOf(tags),
        // AutoCAD has no "off" flag: a layer that is off has its colour index negated.
        off: colorIndex < 0,
        frozen: (flags & 1) !== 0,
        locked: (flags & 4) !== 0,
        // 290 is the plot flag; its absence means plottable.
        plot: has(tags, 290) ? number(tags, 290, 1) !== 0 : true,
        lineType: lineType || "CONTINUOUS",
        lineWeight: has(tags, 370) ? lineWeightFromDxf(number(tags, 370, -1)) : undefined,
    };
}

function readBlocks(tags: DxfTag[], start: number, drawing: DxfDrawing, unsupported: Set<string>): number {
    let i = start;
    for (; i < tags.length; i++) {
        const tag = tags[i];
        if (tag.code !== 0) continue;
        const name = tag.value.trim().toUpperCase();
        if (name === "ENDSEC" || name === "EOF") break;
        if (name !== "BLOCK") continue;

        // The BLOCK record's own tags run until the first entity inside it.
        const header: DxfTag[] = [];
        let j = i + 1;
        for (; j < tags.length && tags[j].code !== 0; j++) header.push(tags[j]);

        const result = collect(tags, j, BLOCK_END);
        const block: DxfBlock = {
            name: text(header, 2, ""),
            basePoint: point(header, 10),
            entities: buildEntities(result.records, unsupported),
        };
        if (block.name) drawing.blocks.push(block);
        i = result.end;
    }
    return i;
}

/**
 * Turns records into entities. POLYLINE is the one shape that spans several records - a
 * header, one VERTEX per point and a SEQEND - so it is assembled here rather than in a
 * per-entity builder.
 */
function buildEntities(records: DxfRecord[], unsupported: Set<string>): DxfEntity[] {
    const entities: DxfEntity[] = [];
    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (record.name === "POLYLINE") {
            const vertices: DxfPolylineVertex[] = [];
            let j = i + 1;
            for (; j < records.length && records[j].name === "VERTEX"; j++) {
                const tags = records[j].tags;
                vertices.push({
                    x: number(tags, 10, 0),
                    y: number(tags, 20, 0),
                    bulge: number(tags, 42, 0),
                });
            }
            if (j < records.length && records[j].name === "SEQEND") j += 1;
            entities.push({
                type: "polyline",
                ...commonOf(record.tags),
                vertices,
                closed: (number(record.tags, 70, 0) & 1) !== 0,
                elevation: number(record.tags, 30, 0),
                normal: normalOf(record.tags),
            });
            i = j - 1;
            continue;
        }

        const entity = buildEntity(record);
        if (entity) {
            entities.push(entity);
        } else if (record.name !== "SEQEND" && record.name !== "VERTEX" && record.name !== "ENDBLK") {
            unsupported.add(record.name);
        }
    }
    return entities;
}

function buildEntity(record: DxfRecord): DxfEntity | undefined {
    const tags = record.tags;
    const common = commonOf(tags);
    switch (record.name) {
        case "LINE":
            return { type: "line", ...common, start: point(tags, 10), end: point(tags, 11) };
        case "CIRCLE":
            return {
                type: "circle",
                ...common,
                center: point(tags, 10),
                radius: number(tags, 40, 0),
                normal: normalOf(tags),
            };
        case "ARC":
            return {
                type: "arc",
                ...common,
                center: point(tags, 10),
                radius: number(tags, 40, 0),
                startAngle: number(tags, 50, 0),
                endAngle: number(tags, 51, 360),
                normal: normalOf(tags),
            };
        case "ELLIPSE":
            return {
                type: "ellipse",
                ...common,
                center: point(tags, 10),
                majorAxis: point(tags, 11),
                ratio: number(tags, 40, 1),
                startParam: number(tags, 41, 0),
                endParam: number(tags, 42, Math.PI * 2),
                normal: normalOf(tags),
            };
        case "LWPOLYLINE":
            return buildLwPolyline(tags, common);
        case "POINT":
            return { type: "point", ...common, position: point(tags, 10) };
        case "SOLID":
        case "TRACE":
        case "3DFACE": {
            // Group 13 is optional: a triangle omits it and the fourth corner repeats the
            // third, which is how DXF distinguishes a triangle from a quadrilateral.
            const third = point(tags, 12);
            return {
                type: "solid",
                ...common,
                corners: [point(tags, 10), point(tags, 11), third, has(tags, 13) ? point(tags, 13) : third],
                normal: normalOf(tags),
            };
        }
        case "TEXT":
            return {
                type: "text",
                ...common,
                content: unescapeText(text(tags, 1)),
                position: textPosition(tags),
                height: number(tags, 40, 1),
                rotation: number(tags, 50, 0),
                boxWidth: 0,
                multiline: false,
                attachment: 1,
                normal: normalOf(tags),
            };
        case "MTEXT":
            return buildMText(tags, common);
        case "SPLINE":
            return buildSpline(tags, common);
        case "INSERT":
            return {
                type: "insert",
                ...common,
                blockName: text(tags, 2),
                position: point(tags, 10),
                scale: dxfVec(number(tags, 41, 1), number(tags, 42, 1), number(tags, 43, 1)),
                rotation: number(tags, 50, 0),
                normal: normalOf(tags),
                columns: Math.max(1, Math.trunc(number(tags, 70, 1))),
                rows: Math.max(1, Math.trunc(number(tags, 71, 1))),
                columnSpacing: number(tags, 44, 0),
                rowSpacing: number(tags, 45, 0),
            };
        case "DIMENSION":
            return buildDimension(tags, common);
        default:
            return undefined;
    }
}

/**
 * TEXT's insertion point is group 10, except when it is justified: horizontal
 * justification (72) or vertical justification (73) other than the default makes group 11
 * the point that actually positions the string.
 */
function textPosition(tags: DxfTag[]): DxfVec {
    const justified = number(tags, 72, 0) !== 0 || number(tags, 73, 0) !== 0;
    if (justified && has(tags, 11)) return point(tags, 11);
    return point(tags, 10);
}

function buildLwPolyline(tags: DxfTag[], common: ReturnType<typeof commonOf>): DxfEntity {
    // Vertices interleave: each 10 opens a vertex, and the 20/42 that follow belong to it.
    const vertices: DxfPolylineVertex[] = [];
    let current: DxfPolylineVertex | undefined;
    for (const tag of tags) {
        const value = Number.parseFloat(tag.value.trim());
        if (tag.code === 10) {
            current = { x: Number.isFinite(value) ? value : 0, y: 0, bulge: 0 };
            vertices.push(current);
        } else if (tag.code === 20 && current) {
            current.y = Number.isFinite(value) ? value : 0;
        } else if (tag.code === 42 && current) {
            current.bulge = Number.isFinite(value) ? value : 0;
        }
    }
    return {
        type: "polyline",
        ...common,
        vertices,
        closed: (number(tags, 70, 0) & 1) !== 0,
        elevation: number(tags, 38, 0),
        normal: normalOf(tags),
    };
}

/**
 * MTEXT longer than 250 characters is split across repeated group 3 chunks with the
 * remainder in group 1, in order.
 */
function buildMText(tags: DxfTag[], common: ReturnType<typeof commonOf>): DxfEntity {
    let content = "";
    for (const tag of tags) {
        if (tag.code === 3 || tag.code === 1) content += tag.value;
    }

    // Group 11 is an explicit X-axis direction and wins over the 50 rotation when present.
    const direction = point(tags, 11);
    const rotation =
        has(tags, 11) && (direction.x !== 0 || direction.y !== 0)
            ? (Math.atan2(direction.y, direction.x) * 180) / Math.PI
            : number(tags, 50, 0);

    return {
        type: "text",
        ...common,
        content: unescapeMText(content),
        position: point(tags, 10),
        height: number(tags, 40, 1),
        rotation,
        boxWidth: number(tags, 41, 0),
        multiline: true,
        attachment: Math.min(9, Math.max(1, Math.trunc(number(tags, 71, 1)))),
        normal: normalOf(tags),
    };
}

function buildSpline(tags: DxfTag[], common: ReturnType<typeof commonOf>): DxfEntity {
    const controlPoints: DxfVec[] = [];
    const fitPoints: DxfVec[] = [];
    const knots: number[] = [];
    const weights: number[] = [];

    // Splines repeat 10/20/30 per control point and 11/21/31 per fit point, so they have
    // to be read in stream order rather than by looking a code up once.
    let control: DxfVec | undefined;
    let fit: DxfVec | undefined;
    for (const tag of tags) {
        const value = Number.parseFloat(tag.value.trim());
        const safe = Number.isFinite(value) ? value : 0;
        switch (tag.code) {
            case 10:
                control = dxfVec(safe, 0, 0);
                controlPoints.push(control);
                break;
            case 20:
                if (control) control.y = safe;
                break;
            case 30:
                if (control) control.z = safe;
                break;
            case 11:
                fit = dxfVec(safe, 0, 0);
                fitPoints.push(fit);
                break;
            case 21:
                if (fit) fit.y = safe;
                break;
            case 31:
                if (fit) fit.z = safe;
                break;
            case 40:
                knots.push(safe);
                break;
            case 41:
                weights.push(safe);
                break;
            default:
                break;
        }
    }

    return {
        type: "spline",
        ...common,
        degree: Math.max(1, Math.trunc(number(tags, 71, 3))),
        closed: (number(tags, 70, 0) & 1) !== 0,
        controlPoints,
        knots,
        weights,
        fitPoints,
    };
}

/**
 * Group 70's low three bits are the dimension kind; the high bits are flags (32 says the
 * block is not shared, 128 that the text was moved) and have to be masked off first.
 */
function dimensionKind(flags: number): DxfDimensionKind {
    switch (flags & 7) {
        case 1:
            return "aligned";
        case 2:
        case 5:
            return "angular";
        case 3:
            return "diameter";
        case 4:
            return "radius";
        default:
            return "linear";
    }
}

function buildDimension(tags: DxfTag[], common: ReturnType<typeof commonOf>): DxfEntity {
    const override = text(tags, 1);
    return {
        type: "dimension",
        ...common,
        dimensionType: dimensionKind(number(tags, 70, 0)),
        definitionPoint: point(tags, 10),
        textMidPoint: point(tags, 11),
        point1: has(tags, 13) ? point(tags, 13) : undefined,
        point2: has(tags, 14) ? point(tags, 14) : undefined,
        point3: has(tags, 15) ? point(tags, 15) : undefined,
        point4: has(tags, 16) ? point(tags, 16) : undefined,
        rotation: number(tags, 50, 0),
        // "<>" is AutoCAD's placeholder for the measured value, i.e. no override at all.
        text: override && override !== "<>" ? unescapeMText(override) : undefined,
        normal: normalOf(tags),
        blockName: text(tags, 2) || undefined,
    };
}

/** DXF escapes a literal `^` in TEXT as `^ `, and encodes control characters as `^X`. */
function unescapeText(value: string): string {
    return value.replace(/\^(.)/g, (match, char: string) => {
        if (char === " ") return "^";
        const code = char.toUpperCase().charCodeAt(0) - 64;
        return code >= 0 && code < 32 ? String.fromCharCode(code) : match;
    });
}

/**
 * Strips MTEXT's inline formatting down to the text itself: `\P` is a line break, `\~` a
 * non-breaking space, `{...}` groups carry per-run formatting, and the rest of the
 * backslash codes (\f font, \H height, \C colour, ...) style a run without adding
 * characters. DraftWorks stores unstyled text, so the codes are dropped and the content
 * kept.
 */
export function unescapeMText(value: string): string {
    let result = "";
    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if (char === "\\") {
            const next = value[i + 1];
            if (next === "P") {
                result += "\n";
                i += 1;
            } else if (next === "~") {
                result += " ";
                i += 1;
            } else if (next === "\\" || next === "{" || next === "}") {
                result += next;
                i += 1;
            } else if (next !== undefined && /[A-Za-z]/.test(next)) {
                // A formatting run: everything up to its terminating ; or the next brace.
                let j = i + 2;
                while (j < value.length && value[j] !== ";" && value[j] !== "{" && value[j] !== "}") j++;
                i = value[j] === ";" ? j : j - 1;
            } else {
                i += 1;
            }
            continue;
        }
        if (char === "{" || char === "}") continue;
        result += char;
    }
    return result;
}
