import { VisualConfig } from "../config";
import type { XYZ } from "../math";
import type { EdgeMeshData } from "../shape";
import { type IView, worldUnitsPerPixel } from "../visual";
import type { SnapType } from "./snap";

/**
 * AutoCAD's AutoSnap markers: the glyph that says *which* snap you are about to get.
 * A square is an endpoint, a triangle a midpoint, a circle a centre, an X an
 * intersection. Reading the shape is faster than reading the tooltip, which is the
 * whole point - you learn to aim at the triangle without looking away from the drawing.
 *
 * Glyphs are declared as polylines in a unit box (x and y both run -1..1, origin at the
 * snap point) and mapped into the drawing plane at display time, so one definition
 * serves every zoom level and the markers stay a constant size on screen.
 */

/** A glyph: one or more open polylines. Repeat the first point to close a loop. */
export type SnapGlyph = readonly (readonly (readonly [number, number])[])[];

function circle(segments: number, radius = 1): readonly (readonly [number, number])[] {
    const points: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    return points;
}

const SQUARE: SnapGlyph = [
    [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
    ],
];

// Sits low in the box so the apex does not read as an arrow pointing at nothing.
const TRIANGLE: SnapGlyph = [
    [
        [-1, -0.75],
        [1, -0.75],
        [0, 0.98],
        [-1, -0.75],
    ],
];

const CIRCLE: SnapGlyph = [circle(16)];

const CROSS: SnapGlyph = [
    [
        [-1, -1],
        [1, 1],
    ],
    [
        [-1, 1],
        [1, -1],
    ],
];

// Two outer sides plus the inner right-angle tick: AutoCAD's ⊥.
const PERPENDICULAR: SnapGlyph = [
    [
        [-1, 1],
        [-1, -1],
        [1, -1],
    ],
    [
        [-1, 0],
        [0, 0],
        [0, -1],
    ],
];

const TANGENT: SnapGlyph = [
    circle(16, 0.85),
    [
        [-1, 1],
        [1, 1],
    ],
];

/** AutoCAD's Node marker - a circle crossed through. */
const NODE: SnapGlyph = [
    circle(16, 0.9),
    [
        [-0.9, -0.9],
        [0.9, 0.9],
    ],
    [
        [-0.9, 0.9],
        [0.9, -0.9],
    ],
];

/** AutoCAD's Nearest marker - the hourglass. */
const HOURGLASS: SnapGlyph = [
    [
        [-1, 1],
        [1, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
    ],
];

/**
 * Which glyph each snap kind wears. Kinds absent from here have no glyph in AutoCAD
 * either (tracking, typed input, axis locks) and fall back to a plain point.
 */
export const SnapMarkerGlyphs: Partial<Record<SnapType, SnapGlyph>> = {
    end: SQUARE,
    middle: TRIANGLE,
    center: CIRCLE,
    intersection: CROSS,
    traceIntersect: CROSS,
    perpendicular: PERPENDICULAR,
    tangent: TANGENT,
    vertex: NODE,
    nearCurve: HOURGLASS,
};

export function hasSnapMarker(type: SnapType): boolean {
    return SnapMarkerGlyphs[type] !== undefined;
}

export interface SnapMarkerOptions {
    type: SnapType;
    /** Where the marker is centred - the snap point itself. */
    point: XYZ;
    /** Drawing-plane axes the glyph is laid out on; these are screen right and up. */
    xAxis: XYZ;
    yAxis: XYZ;
    /** Full width and height of the glyph, in drawing units. */
    size: number;
    color: number;
    lineWidth?: number;
}

/**
 * Builds the line work for one marker, or undefined when the snap kind has no glyph.
 *
 * The result is segment pairs, which is what the renderer's LineSegments2 expects: a
 * polyline of n points becomes n-1 independent segments.
 */
export function createSnapMarkerMesh(options: SnapMarkerOptions): EdgeMeshData | undefined {
    const glyph = SnapMarkerGlyphs[options.type];
    if (!glyph || options.size <= 0) return undefined;

    const half = options.size / 2;
    const positions: number[] = [];

    const push = (x: number, y: number) => {
        const world = options.point
            .add(options.xAxis.multiply(x * half))
            .add(options.yAxis.multiply(y * half));
        positions.push(world.x, world.y, world.z);
    };

    for (const polyline of glyph) {
        for (let i = 0; i + 1 < polyline.length; i++) {
            push(polyline[i][0], polyline[i][1]);
            push(polyline[i + 1][0], polyline[i + 1][1]);
        }
    }
    if (positions.length === 0) return undefined;

    return {
        position: new Float32Array(positions),
        range: [],
        color: options.color,
        lineType: "solid",
        lineWidth: options.lineWidth,
    };
}

/**
 * The marker for one snap in a given view, sized so it stays constant on screen.
 *
 * Returns undefined when the snap kind has no glyph, which is the caller's cue to fall
 * back to a plain point rather than draw nothing.
 */
export function snapMarkerMesh(
    view: IView,
    type: SnapType,
    point: XYZ,
    color: number,
): EdgeMeshData | undefined {
    if (!hasSnapMarker(type)) return undefined;

    const scale = worldUnitsPerPixel(view);
    if (scale <= 0) return undefined;

    // The view is locked to one drafting plane, so its axes are screen right and up -
    // which is what keeps the glyphs upright, as AutoCAD's always are.
    const plane = view.workplane;
    return createSnapMarkerMesh({
        type,
        point,
        xAxis: plane.xvec,
        yAxis: plane.yvec,
        size: VisualConfig.snapMarkerPixels * scale,
        color,
        lineWidth: VisualConfig.snapMarkerLineWidth,
    });
}
