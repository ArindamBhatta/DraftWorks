// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// The constraint maths behind the cursor's distance/angle boxes. Getting a sign or
// a wrap wrong here sends the rubber-band line to the mirror image of where the
// user asked for it, which is hard to spot by eye and impossible to spot in review.

import { expect, test } from "@rstest/core";
import { Plane, XYZ } from "../math";
import { applyDynamicLocks, hasAnyLock, normalizeAngle, pointFromPolar, polarOf } from "./dynamicInput";

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
});
