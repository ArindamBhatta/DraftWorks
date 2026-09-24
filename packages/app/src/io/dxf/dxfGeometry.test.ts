import { describe, expect, test } from "@rstest/core";
import { bulgeArc, bulgeOfSweep, deBoor, sampleSpline } from "./dxfGeometry";
import { type DxfSplineEntity, dxfVec } from "./dxfModel";

/**
 * The bulge sign conventions are the part of DXF polylines that is easiest to get
 * backwards, and getting them backwards puts every filleted corner in an imported drawing
 * on the wrong side of its chord. A positive bulge is a counter-clockwise arc, which for a
 * left-to-right chord means the centre is *above* it and the arc dips below.
 */
describe("polyline bulge", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 1, y: 0 };

    test("a bulge of 1 is a semicircle centred on the chord midpoint", () => {
        const arc = bulgeArc(start, end, 1);
        expect(arc?.center.x).toBeCloseTo(0.5);
        expect(arc?.center.y).toBeCloseTo(0);
        expect(arc?.radius).toBeCloseTo(0.5);
        expect(arc?.sweep).toBeCloseTo(180);
    });

    test("a positive bulge sweeps counter-clockwise, putting the centre above the chord", () => {
        const arc = bulgeArc(start, end, Math.tan(Math.PI / 8));
        expect(arc?.sweep).toBeCloseTo(90);
        expect(arc?.center.y).toBeGreaterThan(0);
    });

    test("a negative bulge mirrors both the sweep and the centre", () => {
        const positive = bulgeArc(start, end, 0.5);
        const negative = bulgeArc(start, end, -0.5);
        expect(negative?.sweep).toBeCloseTo(-(positive?.sweep ?? 0));
        expect(negative?.center.y).toBeCloseTo(-(positive?.center.y ?? 0));
        expect(negative?.radius).toBeCloseTo(positive?.radius ?? 0);
    });

    test("an arc of more than a semicircle puts the centre on the far side of the chord", () => {
        // 270 degrees: the centre crosses back over the chord, which a formula that only
        // handled the shallow case would get wrong.
        const arc = bulgeArc(start, end, bulgeOfSweep(270));
        expect(arc?.sweep).toBeCloseTo(270);
        expect(arc?.center.y).toBeCloseTo(-0.5);
        expect(arc?.radius).toBeCloseTo(Math.SQRT1_2);
    });

    test("the endpoints really are on the resulting circle", () => {
        for (const sweep of [30, 90, 180, 270, 350]) {
            const arc = bulgeArc(start, end, bulgeOfSweep(sweep));
            if (!arc) throw new Error(`no arc for a sweep of ${sweep} degrees`);
            expect(Math.hypot(start.x - arc.center.x, start.y - arc.center.y)).toBeCloseTo(arc.radius);
            expect(Math.hypot(end.x - arc.center.x, end.y - arc.center.y)).toBeCloseTo(arc.radius);
        }
    });

    test("a zero bulge is a straight segment, not an arc of infinite radius", () => {
        expect(bulgeArc(start, end, 0)).toBeUndefined();
    });
});

const spline = (overrides: Partial<DxfSplineEntity>): DxfSplineEntity => ({
    type: "spline",
    layer: "0",
    degree: 3,
    closed: false,
    controlPoints: [],
    knots: [],
    weights: [],
    fitPoints: [],
    ...overrides,
});

describe("B-spline evaluation", () => {
    // A clamped cubic Bezier is the simplest spline whose exact values are known.
    const bezier = spline({
        degree: 3,
        controlPoints: [dxfVec(0, 0), dxfVec(0, 10), dxfVec(10, 10), dxfVec(10, 0)],
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
    });

    test("a clamped spline starts and ends on its outer control points", () => {
        const points = sampleSpline(bezier);
        expect(points.length).toBeGreaterThan(8);
        expect(points[0].x).toBeCloseTo(0);
        expect(points[0].y).toBeCloseTo(0);
        expect(points[points.length - 1].x).toBeCloseTo(10);
        expect(points[points.length - 1].y).toBeCloseTo(0);
    });

    test("the midpoint matches the cubic Bezier formula rather than the control polygon", () => {
        // B(0.5) for these poles is (5, 7.5). The control polygon's midpoint is (5, 10),
        // so a test that passed on the control points alone would read 10 here.
        const mid = deBoor(3, bezier.controlPoints, [1, 1, 1, 1], bezier.knots, 0.5);
        expect(mid?.x).toBeCloseTo(5);
        expect(mid?.y).toBeCloseTo(7.5);
    });

    test("weights bend the curve, which is what makes a NURBS circle exact", () => {
        // A quarter circle as a rational quadratic: the middle weight is cos(45 degrees).
        const quarter = spline({
            degree: 2,
            controlPoints: [dxfVec(1, 0), dxfVec(1, 1), dxfVec(0, 1)],
            knots: [0, 0, 0, 1, 1, 1],
            weights: [1, Math.SQRT1_2, 1],
        });
        for (const point of sampleSpline(quarter)) {
            expect(Math.hypot(point.x, point.y)).toBeCloseTo(1);
        }
    });

    test("a knot vector of the wrong length yields nothing rather than garbage", () => {
        expect(sampleSpline(spline({ degree: 3, controlPoints: [dxfVec(0, 0)], knots: [0, 1] }))).toEqual([]);
    });
});
