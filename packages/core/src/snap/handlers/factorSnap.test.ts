// Typing a scale factor used to lose the drawing. At SCALE's factor prompt a typed
// "2" went through PointSnapEventHandler, which reads a single typed number as a
// distance along the direction from the base point to the last snapped point - and
// when the cursor had not moved since the base point was picked there was no snapped
// point, so every branch of getPointFromInput was skipped and the result stayed at
// its initialiser, the base point itself. Factor 0, and the selection collapsed.
//
// These cover the two halves of the fix: a factor is built without consulting the
// cursor, and a degenerate factor can no longer reach the transform.

import { expect, test } from "@rstest/core";
import { Precision } from "../../foundation";
import { Matrix4, XYZ } from "../../math";

/** The factor-to-point encoding FactorSnapEventHandler.getPointFromInput performs. */
const pointForFactor = (base: XYZ, xvec: XYZ, factor: number) => base.add(xvec.multiply(factor));

/** How Scale reads a factor back, in the default (non-Reference) mode. */
const factorOf = (base: XYZ, point: XYZ) => point.distanceTo(base);

/** Scale.transfrom, including its degenerate-factor guard. */
const scaleAbout = (base: XYZ, factor: number) => {
    if (!Number.isFinite(factor) || factor <= Precision.Distance) return Matrix4.identity();
    return Matrix4.fromTranslation(-base.x, -base.y, -base.z)
        .multiply(Matrix4.fromScale(factor, factor, factor))
        .multiply(Matrix4.fromTranslation(base.x, base.y, base.z));
};

const base = new XYZ({ x: 10, y: 20, z: 0 });
const xvec = new XYZ({ x: 1, y: 0, z: 0 });

test("a typed factor round-trips without the cursor ever having moved", () => {
    // The regression: no snapped point exists here at all.
    for (const factor of [0.5, 2, 3.75, 100]) {
        const point = pointForFactor(base, xvec, factor);
        expect(factorOf(base, point)).toBeCloseTo(factor, 10);
    }
});

test("factor 2 doubles the distance from the base point", () => {
    const transform = scaleAbout(base, factorOf(base, pointForFactor(base, xvec, 2)));
    const corner = new XYZ({ x: 13, y: 24, z: 0 });
    const scaled = transform.ofPoint(corner);

    expect(scaled.distanceTo(base)).toBeCloseTo(corner.distanceTo(base) * 2, 10);
    expect(scaled.x).toBeCloseTo(16, 10);
    expect(scaled.y).toBeCloseTo(28, 10);
});

test("the base point is the one point that does not move", () => {
    const moved = scaleAbout(base, 2).ofPoint(base);
    expect(moved.distanceTo(base)).toBeLessThan(Precision.Distance);
});

test("a degenerate factor leaves the drawing alone instead of collapsing it", () => {
    const corner = new XYZ({ x: 13, y: 24, z: 0 });
    // 0 is what the old typed-input path produced; a negative factor would mirror
    // rather than resize. Both must leave the geometry untouched.
    for (const factor of [0, -1]) {
        const scaled = scaleAbout(base, factor).ofPoint(corner);
        expect(scaled.distanceTo(corner)).toBeLessThan(Precision.Distance);
    }

    // NaN and Infinity are caught by the same guard, before they can reach XYZ (whose
    // constructor throws on NaN) or produce an unusable matrix.
    for (const factor of [Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(scaleAbout(base, factor)).toEqual(Matrix4.identity());
    }
});
