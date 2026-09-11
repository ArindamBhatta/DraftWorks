import type { Vec2 } from "../types";
import type { SliceGrid } from "./layout";
import { type WallSegment, wallAxes } from "./plan";

/**
 * Turns a solved slice grid into the wall network.
 *
 * Three rules, and they are exact only because the layout is rectilinear, axis-aligned
 * and machine-generated - the grid hands over precise interval endpoints, so nothing
 * here has to recover a mitre from geometry. A hand-drawn or non-orthogonal wall network
 * would need real offsetting and trimming instead.
 *
 *  1. Interior partitions are emitted face-to-face: each runs from the inner face of
 *     whatever it abuts at one end to the inner face at the other, so both of its face
 *     lines land exactly on the abutted face and no trim is needed.
 *  2. The external ring's four centrelines run corner to corner, and each carries a
 *     per-end, per-face trim of +/-T/2 - the outer face extends, the inner face retracts.
 *     That is an exact mitre for equal-thickness axis-aligned corners and yields two
 *     clean closed rectangles.
 *  3. Every partition end registers a "junction" opening on the wall it abuts, which
 *     breaks that one face line exactly at the stem so the T reads bonded. No corner
 *     geometry, no booleans - the opening splitter already does the work.
 */
export function buildWalls(grid: SliceGrid): WallSegment[] {
    const { interior: i, externalWallMm: T, internalWallMm: t } = grid;
    const half = T / 2;
    const cx0 = grid.outer.x0 + half;
    const cy0 = grid.outer.y0 + half;
    const cx1 = grid.outer.x1 - half;
    const cy1 = grid.outer.y1 - half;

    const bandY = i.y0 + grid.dF;
    const rearY0 = bandY + t;
    const kitchenX0 = i.x0 + grid.xF + t;
    const masterX0 = grid.hasRearSplit ? i.x0 + grid.xR + t : i.x0;

    // Counter-clockwise, so every external wall's "left" face is the inner one.
    const south = exterior("ext.south", { x: cx0, y: cy0 }, { x: cx1, y: cy0 }, T);
    const east = exterior("ext.east", { x: cx1, y: cy0 }, { x: cx1, y: cy1 }, T);
    const north = exterior("ext.north", { x: cx1, y: cy1 }, { x: cx0, y: cy1 }, T);
    const west = exterior("ext.west", { x: cx0, y: cy1 }, { x: cx0, y: cy0 }, T);

    const frontSplit = partition(
        "part.front",
        { x: i.x0 + grid.xF + t / 2, y: i.y0 },
        { x: i.x0 + grid.xF + t / 2, y: bandY },
        t,
    );
    const kitchenSplit = partition(
        "part.kitchen",
        { x: kitchenX0, y: i.y0 + grid.dKit + t / 2 },
        { x: i.x1, y: i.y0 + grid.dKit + t / 2 },
        t,
    );
    const band = partition("part.band", { x: i.x0, y: bandY + t / 2 }, { x: i.x1, y: bandY + t / 2 }, t);
    const masterSplit = partition(
        "part.master",
        { x: masterX0, y: rearY0 + grid.dM + t / 2 },
        { x: i.x1, y: rearY0 + grid.dM + t / 2 },
        t,
    );

    const walls = [south, east, north, west, frontSplit, kitchenSplit, band, masterSplit];

    addJunction(south, frontSplit.start, { x: 0, y: 1 }, t);
    addJunction(band, frontSplit.end, { x: 0, y: -1 }, t);
    addJunction(frontSplit, kitchenSplit.start, { x: 1, y: 0 }, t);
    addJunction(east, kitchenSplit.end, { x: -1, y: 0 }, t);
    addJunction(west, band.start, { x: 1, y: 0 }, t);
    addJunction(east, band.end, { x: -1, y: 0 }, t);
    addJunction(east, masterSplit.end, { x: -1, y: 0 }, t);

    let rearSplit: WallSegment | undefined;
    if (grid.hasRearSplit) {
        rearSplit = partition(
            "part.rear",
            { x: i.x0 + grid.xR + t / 2, y: rearY0 },
            { x: i.x0 + grid.xR + t / 2, y: i.y1 },
            t,
        );
        walls.push(rearSplit);
        addJunction(band, rearSplit.start, { x: 0, y: 1 }, t);
        addJunction(north, rearSplit.end, { x: 0, y: -1 }, t);
        addJunction(rearSplit, masterSplit.start, { x: 1, y: 0 }, t);

        grid.bedroomSplits.forEach((offset, index) => {
            const wall = partition(
                `part.bedroom${index}`,
                { x: i.x0 + offset + t / 2, y: rearY0 },
                { x: i.x0 + offset + t / 2, y: i.y1 },
                t,
            );
            walls.push(wall);
            addJunction(band, wall.start, { x: 0, y: 1 }, t);
            addJunction(north, wall.end, { x: 0, y: -1 }, t);
        });
    } else {
        addJunction(west, masterSplit.start, { x: 1, y: 0 }, t);
    }

    return walls;
}

function exterior(id: string, start: Vec2, end: Vec2, thickness: number): WallSegment {
    const half = thickness / 2;
    return {
        id,
        start,
        end,
        thicknessMm: thickness,
        exterior: true,
        openings: [],
        // Inner face (left, because the ring runs counter-clockwise) retracts; outer
        // face extends. Together the four walls close into two concentric rectangles.
        trim: { start: { left: -half, right: half }, end: { left: -half, right: half } },
    };
}

function partition(id: string, start: Vec2, end: Vec2, thickness: number): WallSegment {
    return {
        id,
        start,
        end,
        thicknessMm: thickness,
        exterior: false,
        openings: [],
        trim: { start: { left: 0, right: 0 }, end: { left: 0, right: 0 } },
    };
}

/**
 * Records that a stem abuts `host` at `at`, coming from the `stemDir` side. Only the
 * face the stem touches is interrupted; the far face runs straight through, which is
 * exactly how a bonded T-junction is drawn.
 */
export function addJunction(host: WallSegment, at: Vec2, stemDir: Vec2, width: number): void {
    const { dir, normal } = wallAxes(host);
    const centerMm = (at.x - host.start.x) * dir.x + (at.y - host.start.y) * dir.y;
    const face = stemDir.x * normal.x + stemDir.y * normal.y > 0 ? "left" : "right";
    host.openings.push({ kind: "junction", centerMm, widthMm: width, face });
}

/** Sorts each wall's openings by position - the face splitter relies on it. */
export function sortOpenings(walls: WallSegment[]): void {
    for (const wall of walls) wall.openings.sort((a, b) => a.centerMm - b.centerMm);
}
