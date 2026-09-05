// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The neutral in-memory shape of a DXF drawing, sitting between the file text and the
 * document model.
 *
 * It exists so the two halves that are easy to get wrong - parsing DXF group codes and
 * emitting them - can be written and tested without a document, an OCCT kernel or a
 * browser. `dxfReader` produces a `DxfDrawing`, `dxfWriter` consumes one, and only
 * `dxfToNodes`/`nodesToDxf` know anything about DraftWorks nodes.
 *
 * Everything here is plain data: no classes, no kernel types, no I18n.
 */

export interface DxfVec {
    x: number;
    y: number;
    z: number;
}

export const dxfVec = (x = 0, y = 0, z = 0): DxfVec => ({ x, y, z });

/** Group 210/220/230 defaults to +Z: the drawing plane of an ordinary 2D drawing. */
export const DXF_UP: DxfVec = Object.freeze(dxfVec(0, 0, 1));

/**
 * Properties every entity carries. `undefined` means BYLAYER in all three cases, which
 * is both the DXF default and what DraftWorks means by a node with no override, so the
 * absent-vs-explicit distinction survives a round trip.
 */
export interface DxfCommon {
    layer: string;
    /** 0xRRGGBB. Undefined is BYLAYER. */
    color?: number;
    /** DXF linetype name, e.g. CONTINUOUS. Undefined is BYLAYER. */
    lineType?: string;
    /** Lineweight in 1/100 mm, as DXF group 370 stores it. Undefined is BYLAYER. */
    lineWeight?: number;
}

export interface DxfLineEntity extends DxfCommon {
    type: "line";
    start: DxfVec;
    end: DxfVec;
}

export interface DxfCircleEntity extends DxfCommon {
    type: "circle";
    center: DxfVec;
    radius: number;
    normal: DxfVec;
}

/** Angles are degrees, counter-clockwise in the entity's own plane, as DXF stores them. */
export interface DxfArcEntity extends DxfCommon {
    type: "arc";
    center: DxfVec;
    radius: number;
    startAngle: number;
    endAngle: number;
    normal: DxfVec;
}

/**
 * DXF stores an ellipse as centre + the vector to the end of the major axis (relative to
 * the centre) + the minor/major ratio, and trims it with two parameters in radians. A
 * whole ellipse is startParam 0, endParam 2pi.
 */
export interface DxfEllipseEntity extends DxfCommon {
    type: "ellipse";
    center: DxfVec;
    majorAxis: DxfVec;
    ratio: number;
    startParam: number;
    endParam: number;
    normal: DxfVec;
}

/**
 * `bulge` is DXF's way of putting an arc in a polyline: the tangent of a quarter of the
 * arc's included angle, signed counter-clockwise, on the segment that *starts* at this
 * vertex. Zero is a straight segment.
 */
export interface DxfPolylineVertex {
    x: number;
    y: number;
    bulge: number;
}

export interface DxfPolylineEntity extends DxfCommon {
    type: "polyline";
    vertices: DxfPolylineVertex[];
    closed: boolean;
    elevation: number;
    normal: DxfVec;
}

export interface DxfPointEntity extends DxfCommon {
    type: "point";
    position: DxfVec;
}

/**
 * TEXT and MTEXT collapsed into one record, the same way TextAnnotation collapses them:
 * `multiline` says which entity it came from (and which to write back), `boxWidth` is
 * MTEXT's reference-rectangle width, 0 meaning "as wide as it needs to be".
 */
export interface DxfTextEntity extends DxfCommon {
    type: "text";
    content: string;
    /** Left baseline for TEXT, the attachment corner for MTEXT. */
    position: DxfVec;
    height: number;
    /** Degrees, counter-clockwise in the entity's plane. */
    rotation: number;
    boxWidth: number;
    multiline: boolean;
    /**
     * MTEXT's group 71: which corner of the text block `position` names, 1 through 9
     * running top-left, top-centre, top-right, middle-left and so on. DraftWorks anchors
     * MTEXT at its top-left, so anything else has to be shifted on import; our writer
     * always emits 1.
     */
    attachment: number;
    normal: DxfVec;
}

export type DxfDimensionKind = "linear" | "aligned" | "angular" | "radius" | "diameter";

export interface DxfDimensionEntity extends DxfCommon {
    type: "dimension";
    dimensionType: DxfDimensionKind;
    /** Group 10. Dimension line location for linear/aligned, the arc point for angular. */
    definitionPoint: DxfVec;
    /** Group 11. Middle of the measurement text. */
    textMidPoint: DxfVec;
    /** Groups 13/14, and 15/16 for angular: the points that were actually measured. */
    point1?: DxfVec;
    point2?: DxfVec;
    point3?: DxfVec;
    point4?: DxfVec;
    /** Degrees. Rotated-linear dimensions only. */
    rotation: number;
    /** Group 1: text override. Empty/undefined means "use the measurement". */
    text?: string;
    normal: DxfVec;
    /** The anonymous block holding the drawn picture of this dimension. */
    blockName?: string;
}

/**
 * A B-spline, kept as DXF stores it. DraftWorks has no B-spline body, so `dxfToNodes`
 * evaluates it and imports a polyline - see the note there.
 */
export interface DxfSplineEntity extends DxfCommon {
    type: "spline";
    degree: number;
    closed: boolean;
    controlPoints: DxfVec[];
    knots: number[];
    weights: number[];
    fitPoints: DxfVec[];
}

/**
 * A filled quadrilateral. DraftWorks never authors one directly, but dimension arrowheads
 * are written as SOLIDs inside a dimension's picture block, and real drawings use them for
 * filled triangles and bars. A triangle repeats its last corner, which is DXF's own
 * convention rather than a quirk of this writer.
 */
export interface DxfSolidEntity extends DxfCommon {
    type: "solid";
    corners: [DxfVec, DxfVec, DxfVec, DxfVec];
    normal: DxfVec;
}

/** A block reference. Flattened into its block's entities on import. */
export interface DxfInsertEntity extends DxfCommon {
    type: "insert";
    blockName: string;
    position: DxfVec;
    scale: DxfVec;
    /** Degrees. */
    rotation: number;
    normal: DxfVec;
    columns: number;
    rows: number;
    columnSpacing: number;
    rowSpacing: number;
}

export type DxfEntity =
    | DxfLineEntity
    | DxfCircleEntity
    | DxfArcEntity
    | DxfEllipseEntity
    | DxfPolylineEntity
    | DxfPointEntity
    | DxfTextEntity
    | DxfDimensionEntity
    | DxfSplineEntity
    | DxfSolidEntity
    | DxfInsertEntity;

export interface DxfLayerRecord {
    name: string;
    /** 0xRRGGBB. Undefined means the file gave no usable colour. */
    color?: number;
    /** AutoCAD stores "off" as a negative colour index; kept apart from `frozen`. */
    off: boolean;
    frozen: boolean;
    locked: boolean;
    plot: boolean;
    lineType: string;
    /** 1/100 mm. Undefined is "default". */
    lineWeight?: number;
}

export interface DxfBlock {
    name: string;
    basePoint: DxfVec;
    entities: DxfEntity[];
}

export interface DxfDrawing {
    layers: DxfLayerRecord[];
    blocks: DxfBlock[];
    entities: DxfEntity[];
    /** $INSUNITS. See DXF_UNITS. 0 is "unitless". */
    insUnits: number;
    /**
     * Entity types that were present but have no representation here, deduplicated.
     * Surfaced to the user rather than silently dropped.
     */
    unsupported: string[];
}

export const emptyDrawing = (): DxfDrawing => ({
    layers: [],
    blocks: [],
    entities: [],
    insUnits: 0,
    unsupported: [],
});

/** $INSUNITS values for the units DraftWorks can be set to. */
export const DXF_UNITS = {
    unitless: 0,
    in: 1,
    ft: 2,
    mm: 4,
    cm: 5,
    m: 6,
} as const;

export const DXF_LINETYPE_BYLAYER = "ByLayer";
export const DXF_LINETYPE_CONTINUOUS = "CONTINUOUS";

/**
 * DraftWorks' four render styles as DXF linetype names. The names are the ones every
 * CAD application ships in acad.lin, so a file written here draws the same dashes
 * elsewhere; the patterns themselves are written into the LTYPE table by dxfWriter.
 */
export const LINE_TYPE_TO_DXF: Record<string, string> = {
    solid: DXF_LINETYPE_CONTINUOUS,
    dash: "DASHED",
    hidden: "HIDDEN",
    dot: "DOT",
};

export const DXF_TO_LINE_TYPE: Record<string, "solid" | "dash" | "hidden" | "dot"> = {
    CONTINUOUS: "solid",
    SOLID: "solid",
    DASHED: "dash",
    DASHED2: "dash",
    DASHEDX2: "dash",
    HIDDEN: "hidden",
    HIDDEN2: "hidden",
    HIDDENX2: "hidden",
    DOT: "dot",
    DOT2: "dot",
    DOTX2: "dot",
};

/**
 * DraftWorks stores a lineweight as the pixel width it draws at (LAYER_LINE_WEIGHTS);
 * DXF stores hundredths of a millimetre from a fixed ladder of plottable widths. This
 * pairs each pixel step with the plotted width a drafter would expect it to mean.
 */
const PIXEL_TO_HUNDREDTHS_MM: ReadonlyArray<readonly [pixels: number, hundredths: number]> = [
    [1, 25],
    [2, 50],
    [3, 70],
    [4, 100],
    [6, 140],
];

export function lineWeightToDxf(pixels: number): number {
    let best = PIXEL_TO_HUNDREDTHS_MM[0];
    for (const entry of PIXEL_TO_HUNDREDTHS_MM) {
        if (Math.abs(entry[0] - pixels) < Math.abs(best[0] - pixels)) best = entry;
    }
    return best[1];
}

export function lineWeightFromDxf(hundredths: number): number | undefined {
    // -1 BYLAYER, -2 BYBLOCK, -3 DEFAULT: none of them name a width.
    if (hundredths < 0) return undefined;
    let best = PIXEL_TO_HUNDREDTHS_MM[0];
    for (const entry of PIXEL_TO_HUNDREDTHS_MM) {
        if (Math.abs(entry[1] - hundredths) < Math.abs(best[1] - hundredths)) best = entry;
    }
    return best[0];
}

/**
 * The nine named AutoCAD Color Index entries, which are the ones drafters actually
 * choose by number, plus the grey ramp at the top of the palette.
 */
const ACI_FIXED: Readonly<Record<number, number>> = {
    1: 0xff0000,
    2: 0xffff00,
    3: 0x00ff00,
    4: 0x00ffff,
    5: 0x0000ff,
    6: 0xff00ff,
    7: 0xffffff,
    8: 0x414141,
    9: 0x808080,
    250: 0x333333,
    251: 0x505050,
    252: 0x696969,
    253: 0x828282,
    254: 0xbebebe,
    255: 0xffffff,
};

const hsvToRgb = (hue: number, saturation: number, value: number): number => {
    const c = value * saturation;
    const h = (hue / 60) % 6;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = value - c;
    const table: ReadonlyArray<readonly [number, number, number]> = [
        [c, x, 0],
        [x, c, 0],
        [0, c, x],
        [0, x, c],
        [x, 0, c],
        [c, 0, x],
    ];
    const [r, g, b] = table[Math.floor(h)] ?? table[0];
    const to8 = (v: number) => Math.round((v + m) * 255);
    return (to8(r) << 16) | (to8(g) << 8) | to8(b);
};

/**
 * ACI 10-249 is 24 hues, 15 degrees apart, each in five brightness steps at two
 * saturations. This reconstructs the palette from that documented structure rather than
 * carrying a copied 256-entry table, so it lands close to - not exactly on - AutoCAD's
 * published values for those indices. That only affects files written by other
 * applications: our writer always emits the true 24-bit colour in group 420 next to the
 * index, and the reader prefers 420 whenever it is present.
 */
export function aciToRgb(index: number): number | undefined {
    if (!Number.isFinite(index) || index < 1 || index > 255) return undefined;
    const fixed = ACI_FIXED[index];
    if (fixed !== undefined) return fixed;
    if (index < 10) return undefined;

    const offset = index - 10;
    const hue = Math.floor(offset / 10) * 15;
    const step = offset % 10;
    const values = [1, 1, 0.65, 0.65, 0.5, 0.5, 0.3, 0.3, 0.15, 0.15];
    const saturations = [1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5];
    return hsvToRgb(hue, saturations[step], values[step]);
}

/** The index whose colour is closest to `rgb`, for the benefit of readers that ignore 420. */
export function rgbToAci(rgb: number): number {
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    let bestIndex = 7;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 1; i <= 255; i++) {
        const candidate = aciToRgb(i);
        if (candidate === undefined) continue;
        const dr = ((candidate >> 16) & 0xff) - r;
        const dg = ((candidate >> 8) & 0xff) - g;
        const db = (candidate & 0xff) - b;
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
    }
    return bestIndex;
}

/**
 * AutoCAD's Arbitrary Axis Algorithm: entity coordinates are stored in the plane named
 * by the extrusion vector (group 210), not in world space, so anything drawn on a
 * mirrored or tilted plane needs these axes to be placed correctly. For the +Z
 * extrusion of an ordinary 2D drawing this returns the world axes unchanged.
 */
export function ocsAxes(normal: DxfVec): { x: DxfVec; y: DxfVec; z: DxfVec } {
    const length = Math.hypot(normal.x, normal.y, normal.z);
    const z = length > 0 ? dxfVec(normal.x / length, normal.y / length, normal.z / length) : DXF_UP;

    const cross = (a: DxfVec, b: DxfVec) =>
        dxfVec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
    const normalize = (v: DxfVec) => {
        const l = Math.hypot(v.x, v.y, v.z);
        return l > 0 ? dxfVec(v.x / l, v.y / l, v.z / l) : dxfVec(1, 0, 0);
    };

    const nearlyParallelToZ = Math.abs(z.x) < 1 / 64 && Math.abs(z.y) < 1 / 64;
    const x = normalize(cross(nearlyParallelToZ ? dxfVec(0, 1, 0) : dxfVec(0, 0, 1), z));
    return { x, y: normalize(cross(z, x)), z };
}

/** Places a point given in an entity's own plane into world space. */
export function ocsToWorld(point: DxfVec, normal: DxfVec): DxfVec {
    if (normal.x === 0 && normal.y === 0 && normal.z === 1) return point;
    const { x, y, z } = ocsAxes(normal);
    return dxfVec(
        point.x * x.x + point.y * y.x + point.z * z.x,
        point.x * x.y + point.y * y.y + point.z * z.y,
        point.x * x.z + point.y * y.z + point.z * z.z,
    );
}
