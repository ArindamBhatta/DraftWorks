import type { Vec2 } from "../types";

export type EntrySide = "front" | "rear" | "left" | "right";
export const ENTRY_SIDES: readonly EntrySide[] = ["front", "rear", "left", "right"];

/**
 * Everything the floor-plan generator needs, in millimetres. The plot is described the
 * way a draftsman describes it: overall size plus the four setbacks. The building's
 * outer face sits on the setback line, so the setbacks size the footprint but are never
 * themselves drawn.
 */
export interface FloorPlanSpec {
    plotWidthMm: number;
    plotDepthMm: number;
    setbackFrontMm: number;
    setbackRearMm: number;
    setbackLeftMm: number;
    setbackRightMm: number;
    /** 1-4. "2BHK" means 2. */
    bedrooms: number;
    /** Which plot edge the road is on. The plan is laid out canonically then rotated. */
    entrySide: EntrySide;
    externalWallMm: number;
    internalWallMm: number;
    doorWidthMm: number;
    bathDoorWidthMm: number;
    entryDoorWidthMm: number;
    windowWidthMm: number;
    bathWindowWidthMm: number;
    /** Cap height of the room labels, at 1:1. 150 reads well at 1:50 to 1:100. */
    textHeightMm: number;
}

export interface Rect {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

export const rectWidth = (r: Rect) => r.x1 - r.x0;
export const rectDepth = (r: Rect) => r.y1 - r.y0;
export const rectCenter = (r: Rect): Vec2 => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

export type RoomKind = "living" | "kitchen" | "master" | "bedroom" | "bath";

export interface RoomCell {
    id: string;
    kind: RoomKind;
    /** The words that go on the drawing, e.g. "MASTER BEDROOM". */
    name: string;
    /** Interior extent, exclusive of the walls around it. */
    rect: Rect;
}

/**
 * An interruption in a wall.
 *
 * "junction" is not an opening a person walks through - it marks where a partition
 * abuts this wall, so the face line on that side is broken exactly at the stem and the
 * joint reads bonded instead of showing a line straight across the T. Reusing the
 * opening machinery for this is what keeps the wall builder free of corner geometry.
 */
export type OpeningKind = "door" | "window" | "junction";

export interface Opening {
    kind: OpeningKind;
    /** Distance from wall.start to the opening's centre, along the centreline. */
    centerMm: number;
    widthMm: number;
    /** junction only: the single face this eats. */
    face?: "left" | "right";
    /** door only: which jamb carries the hinge. */
    hinge?: "start" | "end";
    /** door only: +1 swings toward the wall's left normal, -1 toward its right. */
    swing?: 1 | -1;
}

export interface WallSegment {
    id: string;
    /** Centreline. Always axis-aligned in the canonical frame. */
    start: Vec2;
    end: Vec2;
    thicknessMm: number;
    exterior: boolean;
    openings: Opening[];
    /**
     * Signed extension of each face line at each end. Interior partitions are emitted
     * face-to-face and need none; the external ring extends its outer face and retracts
     * its inner face by T/2 at every corner, which is an exact mitre for the
     * axis-aligned equal-thickness case.
     */
    trim: {
        start: { left: number; right: number };
        end: { left: number; right: number };
    };
}

export interface FloorPlanIR {
    /** Outer face of the external wall. */
    outer: Rect;
    interior: Rect;
    walls: WallSegment[];
    rooms: RoomCell[];
    spec: FloorPlanSpec;
}

/** Unit direction of a wall, and the normal that defines its "left" face. */
export function wallAxes(wall: WallSegment): { dir: Vec2; normal: Vec2; length: number } {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const length = Math.hypot(dx, dy);
    const dir = { x: dx / length, y: dy / length };
    return { dir, normal: { x: -dir.y, y: dir.x }, length };
}

/** The point on a wall's centreline `s` millimetres from its start, offset onto a face. */
export function wallPoint(wall: WallSegment, s: number, faceOffset = 0): Vec2 {
    const { dir, normal } = wallAxes(wall);
    return {
        x: wall.start.x + dir.x * s + normal.x * faceOffset,
        y: wall.start.y + dir.y * s + normal.y * faceOffset,
    };
}
