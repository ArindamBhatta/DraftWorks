// JOIN's collinear-line rule. Two failures are worth guarding against, and neither
// shows up on the easy case of two segments running left to right from the origin:
// treating a gap as a reason to refuse (JOIN exists to close those), and measuring
// the run from the first endpoint as if nothing could lie behind it - which quietly
// drops any segment on the other side of where the user happened to click first.

import { type ICurve, XYZ } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { basisCurveType, collinearSpan } from "./join";

const at = (x: number, y: number) => new XYZ({ x, y, z: 0 });

/** A curve of the given type, wrapped in `depth` layers of trimming. */
const curve = (curveType: string, depth = 0): ICurve => {
    let built = { curveType } as unknown as ICurve;
    for (let i = 0; i < depth; i++) {
        built = { curveType: "trimmedCurve", basisCurve: built } as unknown as ICurve;
    }
    return built;
};

// The gate in front of the collinear-line join. This is the half that was broken
// while every span test below still passed: an edge's curve is always handed over
// pre-wrapped in a trimmed curve, so testing it for "line" directly matched nothing,
// and every line join quietly fell through to the polyline path.
test("a line edge reads as a line through its trimmed wrapper", () => {
    expect(basisCurveType(curve("line", 1))).toBe("line");
});

test("an untrimmed curve reads as itself", () => {
    expect(basisCurveType(curve("line"))).toBe("line");
});

test("a twice-trimmed line still reads as a line", () => {
    // Break rebuilds edges from already-trimmed curves, so the wrapping can nest.
    expect(basisCurveType(curve("line", 2))).toBe("line");
});

test("a trimmed arc does not pass as a line", () => {
    expect(basisCurveType(curve("circle", 1))).toBe("circle");
});

/** The endpoints of straight segments, in the order the edges would hand them over. */
const endpointsOf = (...segments: [XYZ, XYZ][]) => segments.flat();

test("collinear segments with a gap join into one run spanning both", () => {
    const span = collinearSpan(endpointsOf([at(0, 0), at(10, 0)], [at(20, 0), at(30, 0)]));

    expect(span).toBeDefined();
    expect(span!.start.x).toBeCloseTo(0);
    expect(span!.end.x).toBeCloseTo(30);
    expect(span!.start.y).toBeCloseTo(0);
    expect(span!.end.y).toBeCloseTo(0);
});

test("a segment behind the first endpoint is still part of the run", () => {
    // The run is measured from (0,0) but reaches back to -20: anti-parallel offsets
    // have to count as collinear, or this segment is silently refused.
    const span = collinearSpan(endpointsOf([at(0, 0), at(10, 0)], [at(-20, 0), at(-5, 0)]));

    expect(span).toBeDefined();
    expect(span!.start.x).toBeCloseTo(-20);
    expect(span!.end.x).toBeCloseTo(10);
});

test("overlapping segments join to their outer extremes", () => {
    const span = collinearSpan(endpointsOf([at(0, 0), at(20, 0)], [at(5, 0), at(30, 0)]));

    expect(span!.start.x).toBeCloseTo(0);
    expect(span!.end.x).toBeCloseTo(30);
});

test("the run is oriented the way the first segment was drawn", () => {
    // Segments handed over back to front: the first runs 10 -> 0, so the joined run
    // comes back 30 -> 0 rather than 0 -> 30. Same line either way - but a joined line
    // that kept the direction of what it replaced is the less surprising of the two.
    const span = collinearSpan(endpointsOf([at(10, 0), at(0, 0)], [at(30, 0), at(20, 0)]));

    expect(span!.start.x).toBeCloseTo(30);
    expect(span!.end.x).toBeCloseTo(0);
});

test("the run follows a diagonal as readily as an axis", () => {
    const span = collinearSpan(endpointsOf([at(0, 0), at(3, 3)], [at(6, 6), at(9, 9)]));

    expect(span!.start.x).toBeCloseTo(0);
    expect(span!.start.y).toBeCloseTo(0);
    expect(span!.end.x).toBeCloseTo(9);
    expect(span!.end.y).toBeCloseTo(9);
});

test("parallel but offset segments are not collinear", () => {
    const span = collinearSpan(endpointsOf([at(0, 0), at(10, 0)], [at(0, 5), at(10, 5)]));

    expect(span).toBeUndefined();
});

test("segments meeting at an angle are not collinear", () => {
    const span = collinearSpan(endpointsOf([at(0, 0), at(10, 0)], [at(10, 0), at(10, 10)]));

    expect(span).toBeUndefined();
});

test("a degenerate pile of identical points has no run", () => {
    const span = collinearSpan(endpointsOf([at(4, 4), at(4, 4)], [at(4, 4), at(4, 4)]));

    expect(span).toBeUndefined();
});
