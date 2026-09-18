// FILLET at radius 0 joins two straight lines by running them out to where they cross.
// It used to ask CurveUtils.isLine whether each edge was straight, which asks what the
// curve *is* - and an offset of a line is not an ILine, however straight it runs. A
// perpendicular pair drawn with OFFSET was refused with "a zero radius can only join two
// straight lines", which was both wrong and the opposite of what AutoCAD does.
//
// So straightness is measured instead of asked about. These cover that measurement.

import { type ICurve, XYZ } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { straightDirection } from "./fillet";

const at = (x: number, y: number) => new XYZ({ x, y, z: 0 });

/** A curve that only has to answer `value` - which is all straightness needs. */
const curveOf = (value: (t: number) => XYZ) => ({ value }) as unknown as ICurve;

/** A straight run from `start` towards `direction`, parameterised by arc length. */
const lineCurve = (start: XYZ, direction: XYZ) =>
    curveOf((t) => start.add(direction.normalize()!.multiply(t)));

test("a plain line gives its own direction", () => {
    const curve = lineCurve(at(0, 0), at(1, 0));
    const direction = straightDirection(curve, 0, 10)!;

    expect(direction.x).toBeCloseTo(1);
    expect(direction.y).toBeCloseTo(0);
});

test("an offset line is straight too, whatever its wrapper says", () => {
    // The regression. This is the shape of an offset curve as far as straightness goes:
    // displaced sideways from its basis, running exactly as straight.
    const offset = lineCurve(at(0, 5), at(0, 1));
    const direction = straightDirection(offset, 0, 10)!;

    expect(direction.x).toBeCloseTo(0);
    expect(direction.y).toBeCloseTo(1);
});

test("the direction is a unit vector, so it can be crossed straight away", () => {
    // crossingParameters relies on both directions being unit - it reads the magnitude
    // of their cross product as the sine of the angle between them.
    const curve = lineCurve(at(3, 4), at(3, 4));
    expect(straightDirection(curve, 0, 25)!.length()).toBeCloseTo(1);
});

test("a curve that bows away from its chord is not straight", () => {
    // An arc through (0,0), (5,3), (10,0): the ends lie on the x axis, so a test that
    // only looked at the endpoints would call this a horizontal line.
    const arc = curveOf((t) => at(t, 3 * Math.sin((Math.PI * t) / 10)));
    expect(straightDirection(arc, 0, 10)).toBeUndefined();
});

test("a curve of no length has no direction to give", () => {
    const point = curveOf(() => at(2, 2));
    expect(straightDirection(point, 0, 10)).toBeUndefined();
});

test("two perpendicular offset lines both read as straight", () => {
    // The case from the bug report: FILLET radius 0 on a perpendicular pair.
    const horizontal = straightDirection(lineCurve(at(0, 5), at(1, 0)), 0, 10)!;
    const vertical = straightDirection(lineCurve(at(5, 0), at(0, 1)), 0, 10)!;

    // Perpendicular, so they cross - which is what the sharp corner needs.
    expect(horizontal.dot(vertical)).toBeCloseTo(0);
    expect(horizontal.cross(vertical).length()).toBeCloseTo(1);
});
