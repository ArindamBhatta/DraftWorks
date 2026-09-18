// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// The constraint maths behind the cursor's distance/angle boxes. Getting a sign or
// a wrap wrong here sends the rubber-band line to the mirror image of where the
// user asked for it, which is hard to spot by eye and impossible to spot in review.

import { expect, test } from "@rstest/core";
import { Plane, XYZ } from "../math";
import {
    applyDynamicLocks,
    cartesianOf,
    dimensionGuideLine,
    dimensionGuideSegments,
    hasAnyLock,
    normalizeAngle,
    pointFromCartesian,
    pointFromPolar,
    polarOf,
    protractorSegments,
    readingOf,
} from "./dynamicInput";

const origin = XYZ.zero;
const at = (x: number, y: number) => new XYZ({ x, y, z: 0 });

test("angles wrap into [0, 360)", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(45)).toBe(45);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(361)).toBe(1);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(-450)).toBe(270);
});

test("reading a point as distance and angle", () => {
    expect(polarOf(origin, at(10, 0), Plane.XY)).toEqual({ distance: 10, angle: 0 });

    const up = polarOf(origin, at(0, 5), Plane.XY);
    expect(up.distance).toBeCloseTo(5);
    expect(up.angle).toBeCloseTo(90);

    const diagonal = polarOf(origin, at(3, 4), Plane.XY);
    expect(diagonal.distance).toBeCloseTo(5);
    expect(diagonal.angle).toBeCloseTo(53.13, 1);
});

test("angles are measured counter-clockwise, so below the axis reads as 270 not -90", () => {
    expect(polarOf(origin, at(0, -5), Plane.XY).angle).toBeCloseTo(270);
});

test("a point on the reference point reads zero rather than undefined", () => {
    expect(polarOf(origin, origin, Plane.XY)).toEqual({ distance: 0, angle: 0 });
});

test("polar and cartesian are inverses of each other", () => {
    const point = pointFromPolar(origin, 10, 45, Plane.XY);
    expect(point.x).toBeCloseTo(7.0711);
    expect(point.y).toBeCloseTo(7.0711);

    const back = polarOf(origin, point, Plane.XY);
    expect(back.distance).toBeCloseTo(10);
    expect(back.angle).toBeCloseTo(45);
});

test("both readings are measured from the reference point, not the world origin", () => {
    const ref = at(100, 100);
    const reading = polarOf(ref, at(110, 100), Plane.XY);
    expect(reading.distance).toBeCloseTo(10);
    expect(reading.angle).toBeCloseTo(0);
});

// The four states the two boxes can be in.

test("with nothing locked the point just follows the cursor", () => {
    const cursor = at(3, 4);
    expect(applyDynamicLocks(origin, cursor, {}, Plane.XY).isEqualTo(cursor)).toBe(true);
});

test("locking the distance puts the point on a circle - direction still follows the cursor", () => {
    // Cursor is 5 away at 53.13 degrees; locking 10 keeps that heading, doubles the reach.
    const result = applyDynamicLocks(origin, at(3, 4), { distance: 10 }, Plane.XY);
    expect(polarOf(origin, result, Plane.XY).distance).toBeCloseTo(10);
    expect(polarOf(origin, result, Plane.XY).angle).toBeCloseTo(53.13, 1);
});

test("locking the angle puts the point on a ray - distance still follows the cursor", () => {
    const result = applyDynamicLocks(origin, at(3, 4), { angle: 0 }, Plane.XY);
    expect(polarOf(origin, result, Plane.XY).distance).toBeCloseTo(5);
    expect(result.x).toBeCloseTo(5);
    expect(result.y).toBeCloseTo(0);
});

test("locking both fixes the point outright, wherever the cursor is", () => {
    const fromHere = applyDynamicLocks(origin, at(3, 4), { distance: 10, angle: 90 }, Plane.XY);
    const fromThere = applyDynamicLocks(origin, at(-50, -50), { distance: 10, angle: 90 }, Plane.XY);

    expect(fromHere.isEqualTo(fromThere)).toBe(true);
    expect(fromHere.x).toBeCloseTo(0);
    expect(fromHere.y).toBeCloseTo(10);
});

test("locks work in a plane that is not world XY", () => {
    // The XZ plane: its y axis is world -Z, so 90 degrees points that way.
    const plane = new Plane({ origin: XYZ.zero, normal: XYZ.unitY, xvec: XYZ.unitX });
    const result = applyDynamicLocks(origin, at(1, 0), { distance: 10, angle: 0 }, plane);

    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(0);
});

test("hasAnyLock reports whether the point is constrained at all", () => {
    expect(hasAnyLock({})).toBe(false);
    expect(hasAnyLock({ distance: 10 })).toBe(true);
    expect(hasAnyLock({ angle: 0 })).toBe(true);
    // Zero is a real lock, not an absent one - locking the angle to 0 means "due east".
    expect(hasAnyLock({ angle: 0, distance: 0 })).toBe(true);
    expect(hasAnyLock({ dx: 10 })).toBe(true);
    expect(hasAnyLock({ dy: 0 })).toBe(true);
});

// The cartesian pair - RECTANG's `@10,6`, read and answered along the plane's axes.

test("reading a point along the plane's own axes", () => {
    expect(cartesianOf(origin, at(10, 6), Plane.XY)).toEqual({ dx: 10, dy: 6 });

    // Behind and below the reference point is negative in both, which is a rectangle
    // dragged down and to the left.
    expect(cartesianOf(at(100, 100), at(90, 94), Plane.XY)).toEqual({ dx: -10, dy: -6 });
});

test("axes are the plane's, not the world's", () => {
    // The XZ plane: its y axis is world -Z.
    const plane = new Plane({ origin: XYZ.zero, normal: XYZ.unitY, xvec: XYZ.unitX });
    const reading = cartesianOf(origin, new XYZ({ x: 10, y: 0, z: -6 }), plane);
    expect(reading.dx).toBeCloseTo(10);
    expect(reading.dy).toBeCloseTo(6);
});

test("cartesian reading and point are inverses of each other", () => {
    const point = pointFromCartesian(at(100, 100), 10, 6, Plane.XY);
    expect(point.x).toBeCloseTo(110);
    expect(point.y).toBeCloseTo(106);

    const back = cartesianOf(at(100, 100), point, Plane.XY);
    expect(back.dx).toBeCloseTo(10);
    expect(back.dy).toBeCloseTo(6);
});

test("both pairs describe the same offset, so a widget can show either", () => {
    const reading = readingOf(origin, at(3, 4), Plane.XY);
    expect(reading.distance).toBeCloseTo(5);
    expect(reading.angle).toBeCloseTo(53.13, 1);
    expect(reading.dx).toBeCloseTo(3);
    expect(reading.dy).toBeCloseTo(4);
});

test("locking x puts the point on a vertical line - y still follows the cursor", () => {
    const result = applyDynamicLocks(origin, at(3, 4), { dx: 10 }, Plane.XY);
    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(4);
});

test("locking both lengths fixes the corner outright, wherever the cursor is", () => {
    const fromHere = applyDynamicLocks(origin, at(3, 4), { dx: 10, dy: 6 }, Plane.XY);
    const fromThere = applyDynamicLocks(origin, at(-50, -50), { dx: 10, dy: 6 }, Plane.XY);

    expect(fromHere.isEqualTo(fromThere)).toBe(true);
    expect(fromHere.x).toBeCloseTo(10);
    expect(fromHere.y).toBeCloseTo(6);
});

test("a cartesian lock decides the answer even if a polar one is left over", () => {
    // The boxes show one pair at a time, so the pair being typed into is the pair
    // that means anything - a stale distance from the mode before must not bend it.
    const result = applyDynamicLocks(origin, at(3, 4), { dx: 10, distance: 99 }, Plane.XY);
    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(4);
});

// The dimension guide - the second, parallel line the length is written on. A sign
// error here puts the guide on the wrong side, and a flip puts it on a different side
// depending on which way the user happens to be drawing.

test("the guide runs parallel to the segment, offset by the gap", () => {
    const guide = dimensionGuideLine(origin, at(10, 0), Plane.XY, 2)!;

    // Same direction and length as the segment it measures.
    expect(guide[1].sub(guide[0]).length()).toBeCloseTo(10);
    // Shifted perpendicular, so both ends move by the gap and neither along the line.
    expect(guide[0].x).toBeCloseTo(0);
    expect(guide[1].x).toBeCloseTo(10);
    expect(Math.abs(guide[0].y)).toBeCloseTo(2);
    expect(guide[0].y).toBeCloseTo(guide[1].y);
});

test("the guide keeps to one side however the segment is pointing", () => {
    // Drawing right then drawing left must not put the guide above the line one moment
    // and below it the next - it is the same side of the direction of travel both times.
    const rightward = dimensionGuideLine(origin, at(10, 0), Plane.XY, 2)!;
    const leftward = dimensionGuideLine(origin, at(-10, 0), Plane.XY, 2)!;

    expect(Math.sign(rightward[0].y)).toBe(-Math.sign(leftward[0].y));
});

test("the gap is measured from the segment, not from the origin", () => {
    const guide = dimensionGuideLine(at(5, 5), at(15, 5), Plane.XY, 3)!;

    expect(guide[0].x).toBeCloseTo(5);
    expect(guide[1].x).toBeCloseTo(15);
    expect(Math.abs(guide[0].y - 5)).toBeCloseTo(3);
});

test("the guide is offset in the plane, not the world", () => {
    // On ZX the offset has to leave the plane's own normal alone, or the guide floats
    // off the drawing it belongs to.
    const guide = dimensionGuideLine(origin, origin.add(Plane.ZX.xvec.multiply(10)), Plane.ZX, 2)!;

    expect(guide[0].sub(origin).dot(Plane.ZX.normal)).toBeCloseTo(0);
    expect(guide[1].sub(guide[0]).length()).toBeCloseTo(10);
});

test("a segment with no length has no guide", () => {
    // Nothing to be parallel to, so there is nothing to draw - the caller falls back to
    // showing no dimension at all rather than a zero-length line at an arbitrary angle.
    expect(dimensionGuideLine(origin, origin, Plane.XY, 2)).toBeUndefined();
});

test("the guide comes with ticks closing it onto the measured line", () => {
    const segments = dimensionGuideSegments(origin, at(10, 0), Plane.XY, 2)!;

    // The guide itself, plus one tick at each end.
    expect(segments).toHaveLength(3);

    const [guide, startTick, endTick] = segments;
    // Each tick spans the gap, from the real line's endpoint out to the guide's.
    expect(startTick[0].isEqualTo(origin)).toBe(true);
    expect(startTick[1].isEqualTo(guide[0])).toBe(true);
    expect(endTick[0].isEqualTo(at(10, 0))).toBe(true);
    expect(endTick[1].isEqualTo(guide[1])).toBe(true);
    expect(startTick[1].sub(startTick[0]).length()).toBeCloseTo(2);
});

test("a segment with no length has no guide and so no ticks", () => {
    expect(dimensionGuideSegments(origin, origin, Plane.XY, 2)).toBeUndefined();
});

// The protractor - the arc that says which angle, from where, and which way round.

test("the protractor sweeps from zero round to the line's angle", () => {
    const segments = protractorSegments(origin, 90, Plane.XY, 10);

    // The baseline along zero, then the arc.
    const [baseline] = segments;
    expect(baseline[0].isEqualTo(origin)).toBe(true);
    expect(baseline[1].isEqualTo(at(10, 0))).toBe(true);

    // The arc ends on the line's own direction, at the protractor's radius.
    const last = segments[segments.length - 1][1];
    expect(last.x).toBeCloseTo(0);
    expect(last.y).toBeCloseTo(10);
});

test("every point of the arc sits at the radius", () => {
    const segments = protractorSegments(origin, 217, Plane.XY, 7);

    // The baseline aside, each vertex is on the circle - a flat spot would read as a
    // dent in the instrument.
    for (const [, end] of segments) {
        expect(end.distanceTo(origin)).toBeCloseTo(7);
    }
});

test("the arc is smoother for a wider sweep, not uniformly chopped", () => {
    const small = protractorSegments(origin, 10, Plane.XY, 10);
    const large = protractorSegments(origin, 350, Plane.XY, 10);

    // A ten degree turn does not need the segment count a near-full circle does.
    expect(large.length).toBeGreaterThan(small.length);
});

test("a line along the zero direction gets no protractor at all", () => {
    // ORTHO pins every segment to an axis, so this is the ordinary case. The leg on its
    // own would be a stray line drawn straight down the geometry, saying nothing the
    // line does not already say.
    expect(protractorSegments(origin, 0, Plane.XY, 10)).toHaveLength(0);
    expect(protractorSegments(origin, 180, Plane.XY, 10)).toHaveLength(0);
    expect(protractorSegments(origin, 360, Plane.XY, 10)).toHaveLength(0);
});

test("collinear is judged by eye, not by arithmetic", () => {
    // An angle read off a cursor position is never a whole number; these are all
    // straight as far as anyone looking at the screen is concerned.
    for (const angle of [0.0001, 179.999, 180.001, 359.9999]) {
        expect(protractorSegments(origin, angle, Plane.XY, 10)).toHaveLength(0);
    }
});

test("a line just off the axis still gets its arc", () => {
    // The cutoff has to be tight enough that a real turn is never swallowed by it.
    expect(protractorSegments(origin, 2, Plane.XY, 10).length).toBeGreaterThan(1);
    expect(protractorSegments(origin, 178, Plane.XY, 10).length).toBeGreaterThan(1);
});

test("the protractor is measured in the plane, not the world", () => {
    const segments = protractorSegments(origin, 90, Plane.ZX, 10);

    for (const [, end] of segments) {
        expect(end.sub(origin).dot(Plane.ZX.normal)).toBeCloseTo(0);
    }
});

test("the protractor is centred on the point the angle is measured from", () => {
    const center = at(30, -12);
    const segments = protractorSegments(center, 45, Plane.XY, 5);

    expect(segments[0][0].isEqualTo(center)).toBe(true);
    for (const [, end] of segments) {
        expect(end.distanceTo(center)).toBeCloseTo(5);
    }
});

test("a protractor with no radius draws nothing", () => {
    // The caller floors the radius, but a degenerate view scale could still reach zero -
    // and a zero-radius arc is a pile of coincident points, not a hint.
    expect(protractorSegments(origin, 45, Plane.XY, 0)).toHaveLength(0);
});
