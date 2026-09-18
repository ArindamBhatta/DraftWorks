// FILLET at radius 0 crashed on a pair of offset lines: "direction1.cross is not a
// function". CurveUtils.isLine asked only whether `direction` was defined, and an offset
// curve exposes `direction()` as a method - so the guard accepted one and handed the
// caller a function where an XYZ was expected. The failure surfaced in the vector maths,
// a long way from the guard that let it through.

import { expect, test } from "@rstest/core";
import { XYZ } from "../math";
import { CurveUtils, type ICurve } from "./curve";

const asCurve = (shape: object) => shape as unknown as ICurve;

test("a line, whose direction is a vector, is a line", () => {
    const line = asCurve({ direction: new XYZ({ x: 1, y: 0, z: 0 }) });
    expect(CurveUtils.isLine(line)).toBe(true);
});

test("an offset curve, whose direction is a method, is not", () => {
    // The regression. Geometrically an offset of a line is straight, but this object is
    // not an ILine: reading `.direction` gives a function, and everything downstream
    // treats it as a vector.
    const offset = asCurve({ direction: () => new XYZ({ x: 1, y: 0, z: 0 }) });
    expect(CurveUtils.isLine(offset)).toBe(false);
});

test("a curve with no direction at all is not a line", () => {
    expect(CurveUtils.isLine(asCurve({}))).toBe(false);
});
