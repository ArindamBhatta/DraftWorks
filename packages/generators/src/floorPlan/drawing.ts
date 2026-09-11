import type { GeneratorContext } from "../registry";
import type { DrawItem, Vec2 } from "../types";
import { LENGTH_EPSILON } from "../units";
import { type Interval, spanOf, splitInterval } from "./intervals";
import {
    type FloorPlanIR,
    type Opening,
    type RoomCell,
    rectCenter,
    rectDepth,
    rectWidth,
    type WallSegment,
    wallAxes,
    wallPoint,
} from "./plan";

/** Rough advance width per character, as a fraction of cap height, for centring labels. */
const CHAR_WIDTH_RATIO = 0.6;

export function buildDrawing(ir: FloorPlanIR, ctx: GeneratorContext): DrawItem[] {
    const items: DrawItem[] = [];
    for (const wall of ir.walls) {
        drawWall(wall, items);
    }
    for (const room of ir.rooms) {
        drawLabel(room, ir.spec.textHeightMm, ctx, items);
    }
    return items.filter(isNotDegenerate);
}

function isNotDegenerate(item: DrawItem): boolean {
    if (item.kind !== "line") return true;
    return Math.hypot(item.b.x - item.a.x, item.b.y - item.a.y) > LENGTH_EPSILON;
}

function drawWall(wall: WallSegment, items: DrawItem[]): void {
    const { length } = wallAxes(wall);
    const half = wall.thicknessMm / 2;
    const doors = wall.openings.filter((o) => o.kind === "door");
    const windows = wall.openings.filter((o) => o.kind === "window");

    // Face lines. Doors break both faces; a junction breaks only the face its stem
    // touches; windows break neither - the glass line runs between two continuous
    // faces, which is what makes the three-parallel-lines window symbol read.
    for (const face of ["left", "right"] as const) {
        const sign = face === "left" ? 1 : -1;
        const domain: Interval = { lo: -wall.trim.start[face], hi: length + wall.trim.end[face] };
        const cuts = wall.openings
            .filter((o) => o.kind === "door" || (o.kind === "junction" && o.face === face))
            .map(spanOf);
        for (const piece of splitInterval(domain, cuts)) {
            items.push({
                kind: "line",
                layer: "WALL",
                a: wallPoint(wall, piece.lo, sign * half),
                b: wallPoint(wall, piece.hi, sign * half),
            });
        }
    }

    // Jambs close the reveal at both ends of every opening.
    for (const opening of [...doors, ...windows]) {
        const layer = opening.kind === "door" ? "WALL" : "WINDOW";
        const span = spanOf(opening);
        for (const s of [span.lo, span.hi]) {
            items.push({
                kind: "line",
                layer,
                a: wallPoint(wall, s, half),
                b: wallPoint(wall, s, -half),
            });
        }
    }

    for (const door of doors) drawDoor(wall, door, items);
    for (const window of windows) {
        const span = spanOf(window);
        items.push({
            kind: "line",
            layer: "WINDOW",
            a: wallPoint(wall, span.lo, 0),
            b: wallPoint(wall, span.hi, 0),
        });
    }
}

function drawDoor(wall: WallSegment, door: Opening, items: DrawItem[]): void {
    const { normal } = wallAxes(wall);
    const span = spanOf(door);
    const hingeS = door.hinge === "start" ? span.lo : span.hi;
    const otherS = door.hinge === "start" ? span.hi : span.lo;

    const hinge = wallPoint(wall, hingeS, 0);
    const other = wallPoint(wall, otherS, 0);
    const swing = door.swing ?? 1;
    const leaf: Vec2 = { x: normal.x * swing, y: normal.y * swing };
    const tip: Vec2 = { x: hinge.x + leaf.x * door.widthMm, y: hinge.y + leaf.y * door.widthMm };

    // The sweep is measured, not assumed: computing the signed angle from the open leaf
    // back to the wall keeps the arc correct for either hand and through the plan's
    // orientation rotation, where a hardcoded +/-90 would eventually point the wrong way.
    const ux = (other.x - hinge.x) / door.widthMm;
    const uy = (other.y - hinge.y) / door.widthMm;
    const cross = leaf.x * uy - leaf.y * ux;
    const dot = leaf.x * ux + leaf.y * uy;
    const sweepDeg = (Math.atan2(cross, dot) * 180) / Math.PI;

    items.push({ kind: "line", layer: "DOOR", a: hinge, b: tip });
    items.push({ kind: "arc", layer: "DOOR", center: hinge, start: tip, sweepDeg });
}

function drawLabel(room: RoomCell, height: number, ctx: GeneratorContext, items: DrawItem[]): void {
    const center = rectCenter(room.rect);
    const size = `${ctx.format(rectWidth(room.rect))} X ${ctx.format(rectDepth(room.rect))}`;
    const lines: [string, number][] = [
        [room.name, center.y + 0.15 * height],
        [size, center.y - 1.15 * height],
    ];

    for (const [text, y] of lines) {
        items.push({
            kind: "text",
            layer: "TEXT",
            // TextAnnotation's position is the left baseline, so centring is ours to do.
            at: { x: center.x - CHAR_WIDTH_RATIO * 0.5 * height * text.length, y },
            text,
            heightMm: height,
            rotationDeg: 0,
        });
    }
}

export { splitInterval };
