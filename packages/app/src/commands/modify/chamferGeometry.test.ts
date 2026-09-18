// The trigonometry behind CHAMFER's Distance and Angle methods. The kernel only ever
// steps back the same distance along both lines, so everything AutoCAD offers past the
// equal-distance case is worked out here - and a sign or a sine put the wrong way round
// produces a chamfer that looks plausible and measures wrong, which is exactly the kind
// of thing that survives a glance at the screen.

import { XYZ } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { angleMethodSetbacks, chamferCuts, cornerAngleBetween } from "./chamferGeometry";

const dir = (x: number, y: number) => new XYZ({ x, y, z: 0 }).normalize()!;

test("a 45 degree chamfer on a right angle sets back equally", () => {
    // The symmetric case, where the Angle method has to agree with the Distance method
    // given the same numbers - the one answer that can be checked without trigonometry.
    const setbacks = angleMethodSetbacks(10, 45, 90)!;

    expect(setbacks.first).toBeCloseTo(10);
    expect(setbacks.second).toBeCloseTo(10);
});

test("a shallower angle reaches further along the second line", () => {
    // Leaving the first line at 30 rather than 45 means meeting the second one further
    // out, so the second setback grows while the given one stays put.
    const shallow = angleMethodSetbacks(10, 30, 90)!;

    expect(shallow.first).toBeCloseTo(10);
    expect(shallow.second).toBeLessThan(10);

    const steep = angleMethodSetbacks(10, 60, 90)!;
    expect(steep.second).toBeGreaterThan(10);
});

test("the sine rule holds against a worked triangle", () => {
    // 10 along the first line, leaving it at 30, into a corner of 60: the third angle is
    // 90, so the second side is 10 * sin(30) / sin(90) = 5 exactly.
    const setbacks = angleMethodSetbacks(10, 30, 60)!;
    expect(setbacks.second).toBeCloseTo(5, 10);
});

test("a triangle that cannot close has no chamfer", () => {
    // The chamfer would never meet the second line: the two angles already use up the
    // half turn, leaving nothing for the third.
    expect(angleMethodSetbacks(10, 90, 90)).toBeUndefined();
    expect(angleMethodSetbacks(10, 120, 90)).toBeUndefined();
    // And a chamfer of no length is not a chamfer.
    expect(angleMethodSetbacks(0, 45, 90)).toBeUndefined();
    expect(angleMethodSetbacks(-5, 45, 90)).toBeUndefined();
});

test("the corner angle is the one inside the corner", () => {
    expect(cornerAngleBetween(dir(1, 0), dir(0, 1))).toBeCloseTo(90);
    expect(cornerAngleBetween(dir(1, 0), dir(1, 1))).toBeCloseTo(45);
    // Read from either side, the same corner reads the same.
    expect(cornerAngleBetween(dir(0, 1), dir(1, 0))).toBeCloseTo(90);
});

test("each cut steps back towards the line that is actually there", () => {
    // The corner sits at parameter 0 on both lines; the edges run in opposite
    // directions from it, and each cut has to follow its own edge rather than the
    // empty extension on the other side.
    const cuts = chamferCuts(0, 5, 0, -5, { first: 2, second: 3 });

    expect(cuts.cut1).toBeCloseTo(2);
    expect(cuts.cut2).toBeCloseTo(-3);
});

test("the two setbacks are applied to their own lines, not swapped", () => {
    // An unequal chamfer put on the wrong way round is the failure this whole file
    // exists to catch: it looks like a chamfer, and it is the mirror of the one asked for.
    // The first edge lies above its corner parameter and the second below its own, so
    // the setbacks go opposite ways - each towards its own line.
    const cuts = chamferCuts(100, 200, 50, 10, { first: 2, second: 7 });

    expect(cuts.cut1).toBeCloseTo(102);
    expect(cuts.cut2).toBeCloseTo(43);
});
