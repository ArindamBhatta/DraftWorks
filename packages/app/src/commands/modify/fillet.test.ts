// FILLET at radius 0 is AutoCAD's sharp corner, and the two calculations behind it fail
// quietly rather than loudly: a crossing worked out from the wrong pair of lines still
// produces a corner, just not the one on screen, and a span that keeps the wrong side of
// the corner deletes the half of the line the user was looking at. Both are parameter
// arithmetic, so they can be pinned down without OCCT.

import { type ICurve, XYZ } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { cornerSpan, crossingParameters, supportCurve } from "./fillet";

const at = (x: number, y: number, z = 0) => new XYZ({ x, y, z });

const X = at(1, 0);
const Y = at(0, 1);

// Two lines that stop short of each other - the case radius 0 exists for. They cross at
// (10, 0): 10 along the first from its origin, 5 back down the second from (10, 5).
test("two lines that never touch still cross where their lines do", () => {
    const crossing = crossingParameters(at(0, 0), X, at(10, 5), Y);
    expect(crossing).toEqual({ param1: 10, param2: -5 });
});

test("parallel lines have no crossing", () => {
    expect(crossingParameters(at(0, 0), X, at(0, 5), X)).toBeUndefined();
});

test("lines passing each other in space have no crossing", () => {
    // The second runs along Y at z = 3, so nothing on it is ever on the first.
    expect(crossingParameters(at(0, 0), X, at(10, 5, 3), Y)).toBeUndefined();
});

// A line running 0..10 whose corner lies out past its end: the end travels to the corner
// and the line keeps the whole of itself.
test("a corner beyond an end pulls that end out to it", () => {
    expect(cornerSpan(0, 10, 14)).toEqual({ start: 0, end: 14 });
});

test("a corner behind the start pulls the other way", () => {
    expect(cornerSpan(0, 10, -4)).toEqual({ start: -4, end: 10 });
});

test("a corner inside the line keeps the longer side", () => {
    expect(cornerSpan(0, 10, 8)).toEqual({ start: 0, end: 8 });
    expect(cornerSpan(0, 10, 2)).toEqual({ start: 2, end: 10 });
});

test("a corner already at an end leaves the line whole", () => {
    expect(cornerSpan(0, 10, 10)).toEqual({ start: 0, end: 10 });
    expect(cornerSpan(0, 10, 0)).toEqual({ start: 0, end: 10 });
});

/** A curve of the given type, wrapped in `depth` layers of trimming. */
const curve = (curveType: string, depth = 0): ICurve => {
    let built = { curveType } as unknown as ICurve;
    for (let i = 0; i < depth; i++) {
        built = { curveType: "trimmedCurve", basisCurve: built } as unknown as ICurve;
    }
    return built;
};

// An edge's curve is always trimmed once, and twice when it was built from a curve that
// had been trimmed before - Break does that. Stopping at the first layer would hand the
// corner a curve with no direction to read, and every sharp corner would be refused.
test("a twice-trimmed line reaches the line underneath", () => {
    expect(supportCurve(curve("line", 2)).curveType).toBe("line");
});

test("an untrimmed curve is its own support", () => {
    expect(supportCurve(curve("line")).curveType).toBe("line");
});

// An offset curve has a basisCurve too, but it runs somewhere else entirely - reaching
// through one would answer with a line the edge is not on.
test("an offset curve is not reached through", () => {
    expect(supportCurve(curve("offsetCurve", 1)).curveType).toBe("offsetCurve");
});
