// Where a filleted or chamfered rectangle's corners land. The arithmetic is short but
// easy to get subtly wrong, and a wrong answer draws a shape that looks nearly right -
// an arc centre one setback out still produces a rounded corner, just not a tangent one.

import { Plane, XYZ } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { rectArea, rectCorners, rectPerimeter } from "./rect";

const at = (x: number, y: number, z = 0) => new XYZ({ x, y, z });

/** The world XY plane, origin at (0,0) - the workplane a 2D drawing is drawn on. */
const xy = new Plane({ origin: at(0, 0), normal: at(0, 0, 1), xvec: at(1, 0, 0) });

test("each corner is cut back by the setback along both of its sides", () => {
    const { corners } = rectCorners(xy, 100, 60, 10);

    // The corner at the origin: its sides run out along +x and back along +y, so the
    // treatment meets them 10 short of the corner on each.
    const first = corners[0];
    expect(first.from.x).toBeCloseTo(0);
    expect(first.from.y).toBeCloseTo(10);
    expect(first.to.x).toBeCloseTo(10);
    expect(first.to.y).toBeCloseTo(0);
});

test("the fillet centre is one setback in from the corner on both axes", () => {
    const { corners } = rectCorners(xy, 100, 60, 10);

    // Tangency is the whole point: the centre has to sit setback away from each side,
    // or the arc meets the straight edges at an angle instead of flowing into them.
    expect(corners[0].center.x).toBeCloseTo(10);
    expect(corners[0].center.y).toBeCloseTo(10);

    // And the far corner, to catch a sign that only works near the origin.
    const opposite = corners[2];
    expect(opposite.center.x).toBeCloseTo(90);
    expect(opposite.center.y).toBeCloseTo(50);
});

test("every fillet centre is exactly the setback from the two sides it touches", () => {
    const setback = 12;
    const { corners } = rectCorners(xy, 80, 40, setback);

    for (const corner of corners) {
        expect(corner.center.distanceTo(corner.from)).toBeCloseTo(setback);
        expect(corner.center.distanceTo(corner.to)).toBeCloseTo(setback);
    }
});

test("the side into each corner starts where the previous corner's treatment ended", () => {
    const { corners } = rectCorners(xy, 100, 60, 10);

    // Otherwise the wire has gaps: side, treatment, side, treatment has to close up.
    for (let i = 0; i < 4; i++) {
        const previous = corners[(i + 3) % 4];
        expect(corners[i].sideStart.distanceTo(previous.to)).toBeCloseTo(0);
    }
});

test("dragging down and left traverses the same way as up and right", () => {
    // Both negatives cancel: the corner order (0,0) (dx,0) (dx,dy) (0,dy) sweeps the
    // same rotational direction, which the signed area confirms. So the arcs bend the
    // same way too - this is the case that looks like it should reverse and does not.
    expect(rectCorners(xy, 100, 60, 10).winding).toBe(1);
    expect(rectCorners(xy, -100, -60, 10).winding).toBe(1);
});

test("one negative side does reverse the traversal", () => {
    // Dragged down-and-right, or up-and-left: the arcs have to bend with it or they
    // bulge out of the shape instead of rounding into it.
    expect(rectCorners(xy, 100, -60, 10).winding).toBe(-1);
    expect(rectCorners(xy, -100, 60, 10).winding).toBe(-1);
});

test("corner points stay on the rectangle's own sides when it is drawn backwards", () => {
    // dx/dy negative puts the far corner at (-100,-60); the treatment still has to cut
    // inward, not run off past the corner.
    const { corners } = rectCorners(xy, -100, -60, 10);

    for (const corner of corners) {
        expect(Math.abs(corner.from.x)).toBeLessThanOrEqual(100.001);
        expect(Math.abs(corner.from.y)).toBeLessThanOrEqual(60.001);
        expect(corner.from.x).toBeLessThanOrEqual(0.001);
        expect(corner.from.y).toBeLessThanOrEqual(0.001);
    }
});

test("an untreated rectangle measures the way it always did", () => {
    expect(rectPerimeter(100, 60, 0, false)).toBeCloseTo(320);
    expect(rectArea(100, 60, 0, false)).toBeCloseTo(6000);
});

test("a filleted rectangle is shorter round and smaller inside than a sharp one", () => {
    // Rounding a corner cuts the path across it, so both measures fall - the point is
    // that the palette stops reporting the sharp-cornered numbers for a rounded shape.
    expect(rectPerimeter(100, 60, 10, true)).toBeLessThan(320);
    expect(rectArea(100, 60, 10, true)).toBeLessThan(6000);
});

test("a fully rounded rectangle is a stadium, and a square one a circle", () => {
    // setback = half the short side rounds the two ends right off: two semicircles
    // joined by the leftover straight, which is the shape's own closed form.
    const r = 30;
    const stadium = 2 * (100 - 2 * r) + 2 * Math.PI * r;
    expect(rectPerimeter(100, 60, r, true)).toBeCloseTo(stadium);

    // A square treated to half its side is exactly a circle of that radius.
    expect(rectPerimeter(60, 60, 30, true)).toBeCloseTo(2 * Math.PI * 30);
    expect(rectArea(60, 60, 30, true)).toBeCloseTo(Math.PI * 30 * 30);
});

test("a chamfer takes more off the area than a fillet of the same setback", () => {
    // The chamfer's straight cut passes inside the fillet's arc, so it removes the
    // larger bite. Getting these the wrong way round is the easy mistake.
    expect(rectArea(100, 60, 10, false)).toBeLessThan(rectArea(100, 60, 10, true));
});

test("a chamfered corner replaces the square with its own hypotenuse", () => {
    // Four corners, each losing 2 setbacks of straight and gaining one hypotenuse.
    const s = 10;
    expect(rectPerimeter(100, 60, s, false)).toBeCloseTo(320 - 8 * s + 4 * Math.SQRT2 * s);
    expect(rectArea(100, 60, s, false)).toBeCloseTo(6000 - (4 * (s * s)) / 2);
});

test("at the largest setback the straight sides vanish rather than going negative", () => {
    // A 60-wide rectangle filleted to 30 is a stadium: the two corners on each short
    // side meet in the middle. The side between them has no length left, and asking the
    // kernel for a zero-length line is what raised "start and end points are too close".
    const { corners } = rectCorners(xy, 100, 60, 30);

    const shortSides = corners.filter((corner) => corner.sideStart.distanceTo(corner.from) < 1e-9);
    expect(shortSides).toHaveLength(2);

    // The long sides still have their straight run - 100 less a setback at each end.
    const longSides = corners
        .map((corner) => corner.sideStart.distanceTo(corner.from))
        .filter((length) => length > 1e-9);
    expect(longSides).toHaveLength(2);
    for (const length of longSides) expect(length).toBeCloseTo(40);
});

test("a square filleted to half its side leaves no straight sides at all", () => {
    // Every side vanishes: this is a circle, and it is the case that errored.
    const { corners } = rectCorners(xy, 60, 60, 30);

    for (const corner of corners) {
        expect(corner.sideStart.distanceTo(corner.from)).toBeCloseTo(0);
    }
});
