import type { Vec2 } from "../types";
import type { EntrySide, FloorPlanIR, Rect } from "./plan";

/**
 * How far the canonical plan (entry on the -Y edge) has to turn for the entry to land on
 * a given plot edge. A quarter turn counter-clockwise sends the front edge to the +X
 * side, so "right" is the quarter turn and "left" the three-quarter one.
 */
const ROTATION_DEG: Record<EntrySide, number> = {
    front: 0,
    right: 90,
    rear: 180,
    left: 270,
};

/**
 * Re-orients a finished plan so its entry faces the requested plot edge.
 *
 * Everything is laid out once, in the canonical frame, and then rigidly rotated - one
 * algorithm, four orientations. Because a rotation is orientation-preserving, each
 * wall's left and right normals turn with it, so door swings, hinges and junction faces
 * all stay correct without a single special case; only the coordinates move.
 */
export function transformIR(ir: FloorPlanIR, entrySide: EntrySide): FloorPlanIR {
    const degrees = ROTATION_DEG[entrySide];
    if (degrees === 0) return ir;

    const rad = (degrees * Math.PI) / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad));
    const rotate = (p: Vec2): Vec2 => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });

    // Keep the drawing in positive coordinates: rotate the plot rectangle too and shift
    // everything back so its lower-left corner stays at the origin.
    const plot = [
        rotate({ x: 0, y: 0 }),
        rotate({ x: ir.spec.plotWidthMm, y: 0 }),
        rotate({ x: ir.spec.plotWidthMm, y: ir.spec.plotDepthMm }),
        rotate({ x: 0, y: ir.spec.plotDepthMm }),
    ];
    const offsetX = -Math.min(...plot.map((p) => p.x));
    const offsetY = -Math.min(...plot.map((p) => p.y));
    const place = (p: Vec2): Vec2 => {
        const r = rotate(p);
        return { x: r.x + offsetX, y: r.y + offsetY };
    };
    const placeRect = (r: Rect): Rect => {
        const corners = [
            place({ x: r.x0, y: r.y0 }),
            place({ x: r.x1, y: r.y0 }),
            place({ x: r.x1, y: r.y1 }),
            place({ x: r.x0, y: r.y1 }),
        ];
        return {
            x0: Math.min(...corners.map((c) => c.x)),
            y0: Math.min(...corners.map((c) => c.y)),
            x1: Math.max(...corners.map((c) => c.x)),
            y1: Math.max(...corners.map((c) => c.y)),
        };
    };

    return {
        spec: ir.spec,
        outer: placeRect(ir.outer),
        interior: placeRect(ir.interior),
        rooms: ir.rooms.map((room) => ({ ...room, rect: placeRect(room.rect) })),
        walls: ir.walls.map((wall) => ({
            ...wall,
            start: place(wall.start),
            end: place(wall.end),
            // centerMm, widths, faces, hinges and swings are all measured along or
            // across the wall, so a rigid rotation leaves every one of them alone.
            openings: wall.openings.map((o) => ({ ...o })),
            trim: { start: { ...wall.trim.start }, end: { ...wall.trim.end } },
        })),
    };
}
