// The measured rows AutoCAD shows under a line's Start and End. Delta and Length are
// arithmetic, but Angle is the one worth pinning: atan2 reports -180..180 and AutoCAD
// reports 0..360, so a line drawn down-and-left is the case that tells the two apart.

import { XYZ } from "@chili3d/core";
import { expect, test } from "@rstest/core";
import { segmentFacts } from "./line";

const at = (x: number, y: number, z = 0) => new XYZ({ x, y, z });

/** The facts keyed by their i18n label, which is how the palette reads them back. */
const factsOf = (start: XYZ, end: XYZ) =>
    Object.fromEntries(segmentFacts(start, end).map((fact) => [fact.display, fact.value]));

test("delta is the end measured from the start, on every axis", () => {
    const facts = factsOf(at(1, 2, 3), at(5, 7, 9));

    expect(facts["geometry.deltaX"]).toBeCloseTo(4);
    expect(facts["geometry.deltaY"]).toBeCloseTo(5);
    expect(facts["geometry.deltaZ"]).toBeCloseTo(6);
});

test("delta is signed, so a line drawn back towards the origin reads negative", () => {
    const facts = factsOf(at(10, 10), at(4, 6));

    expect(facts["geometry.deltaX"]).toBeCloseTo(-6);
    expect(facts["geometry.deltaY"]).toBeCloseTo(-4);
});

test("length is the straight-line distance, not the sum of the deltas", () => {
    expect(factsOf(at(0, 0), at(3, 4))["common.length"]).toBeCloseTo(5);
});

test("angle is measured counter-clockwise from the positive X axis", () => {
    expect(factsOf(at(0, 0), at(10, 0))["common.angle"]).toBeCloseTo(0);
    expect(factsOf(at(0, 0), at(0, 10))["common.angle"]).toBeCloseTo(90);
    expect(factsOf(at(0, 0), at(-10, 0))["common.angle"]).toBeCloseTo(180);
});

test("angle wraps into 0-360 rather than going negative", () => {
    // atan2 would call these -45 and -135; AutoCAD calls them 315 and 225.
    expect(factsOf(at(0, 0), at(10, -10))["common.angle"]).toBeCloseTo(315);
    expect(factsOf(at(0, 0), at(-10, -10))["common.angle"]).toBeCloseTo(225);
});

test("a line pointing straight down reads 270, not -90", () => {
    expect(factsOf(at(5, 5), at(5, 0))["common.angle"]).toBeCloseTo(270);
});

test("every fact is tagged with the kind of quantity it is", () => {
    const kinds = Object.fromEntries(segmentFacts(at(0, 0), at(1, 1)).map((x) => [x.display, x.kind]));

    expect(kinds["geometry.deltaX"]).toBe("length");
    expect(kinds["common.length"]).toBe("length");
    // Angles have no feet-and-inches form - the palette formats them as plain decimals.
    expect(kinds["common.angle"]).toBe("angle");
});
