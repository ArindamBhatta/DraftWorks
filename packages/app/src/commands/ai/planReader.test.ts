/**
 * The edge reader, on stand-in curves.
 *
 * Nothing here builds a real node: a node's geometry comes from the kernel, which is not
 * loaded in a test run, which is why nodesToDxf.ts has no unit test either. What can be
 * pinned without it is the part that actually goes wrong - how a kernel arc's axis
 * becomes a signed sweep, and what happens to the curves DrawItem cannot name.
 */

import type { ICircle, IEdge } from "@draftworks/core";
import { XYZ } from "@draftworks/core";
import type { DrawItem, Vec2 } from "@draftworks/generators";
import { describe, expect, test } from "@rstest/core";
import { readEdge, sweepOf } from "./planReader";

const at = (x: number, y: number, z = 0) => new XYZ({ x, y, z });

/** Metres, so every assertion below shows the unit conversion doing its job. */
const MM_PER_UNIT = 1000;
const toMm = (p: XYZ): Vec2 => ({ x: p.x * MM_PER_UNIT, y: p.y * MM_PER_UNIT });

/** A circle in the XY plane, or turned to face the other way when `axisZ` is -1. */
function circle(cx: number, cy: number, radius: number, axisZ: 1 | -1 = 1): ICircle {
    return {
        center: at(cx, cy),
        radius,
        axis: at(0, 0, axisZ),
        xAxis: at(1, 0),
        // The frame stays right-handed about its own axis, which is what makes a
        // downward axis measure the same geometry the other way round.
        yAxis: at(0, axisZ),
    } as unknown as ICircle;
}

function edgeOf(curve: Record<string, unknown>, start: XYZ, end: XYZ, sampled: XYZ[] = []): IEdge {
    return {
        curve: {
            ...curve,
            startPoint: () => start,
            endPoint: () => end,
            uniformAbscissaByCount: () => sampled,
        },
    } as unknown as IEdge;
}

const read = (edge: IEdge): DrawItem[] => {
    const items: DrawItem[] = [];
    readEdge(edge, "WALL", toMm, MM_PER_UNIT, items);
    return items;
};

describe("sweepOf", () => {
    const at90 = circle(0, 0, 10);

    test("a quarter turn counter-clockwise is +90", () => {
        expect(sweepOf(at90, at(10, 0), at(0, 10))).toBeCloseTo(90);
    });

    test("three quarters counter-clockwise is +270, not -90", () => {
        // The wrap. Measured as a raw angle difference this comes out negative, and an
        // arc that should sweep most of the way round would be drawn as the small piece
        // it leaves behind.
        expect(sweepOf(at90, at(0, 10), at(10, 0))).toBeCloseTo(270);
    });

    test("the same arc about a downward axis sweeps the other way", () => {
        // The conversion this function exists for. The kernel has no clockwise arc - it
        // has a counter-clockwise one seen from below - and DrawItem has no axis, only a
        // sign, so the axis has to become the sign here or every such arc mirrors.
        expect(sweepOf(circle(0, 0, 10, -1), at(10, 0), at(0, -10))).toBeCloseTo(-90);
    });

    test("a half turn is 180 whichever way the axis points", () => {
        expect(sweepOf(at90, at(10, 0), at(-10, 0))).toBeCloseTo(180);
        expect(sweepOf(circle(0, 0, 10, -1), at(10, 0), at(-10, 0))).toBeCloseTo(-180);
    });

    test("an arc standing on edge to the drawing has no 2D sweep", () => {
        const onEdge = { ...circle(0, 0, 10), axis: at(0, 1, 0) } as unknown as ICircle;
        expect(sweepOf(onEdge, at(10, 0), at(0, 0, 10))).toBeUndefined();
    });

    test("the sweep is measured about the circle's centre, not the origin", () => {
        expect(sweepOf(circle(100, 100, 10), at(110, 100), at(100, 110))).toBeCloseTo(90);
    });
});

describe("readEdge", () => {
    test("a line edge becomes a line, converted to millimetres", () => {
        const items = read(edgeOf({ curveType: "line" }, at(0, 0), at(3, 4)));
        expect(items).toEqual([{ kind: "line", layer: "WALL", a: { x: 0, y: 0 }, b: { x: 3000, y: 4000 } }]);
    });

    test("a circle edge whose ends meet becomes a circle, with its radius converted too", () => {
        const items = read(edgeOf({ ...circle(1, 2, 5), curveType: "circle" }, at(6, 2), at(6, 2)));
        expect(items).toEqual([
            { kind: "circle", layer: "WALL", center: { x: 1000, y: 2000 }, radiusMm: 5000 },
        ]);
    });

    test("a circle edge with ends apart becomes an arc carrying its sweep", () => {
        const items = read(edgeOf({ ...circle(0, 0, 10), curveType: "circle" }, at(10, 0), at(0, 10)));
        expect(items).toEqual([
            {
                kind: "arc",
                layer: "WALL",
                center: { x: 0, y: 0 },
                start: { x: 10000, y: 0 },
                sweepDeg: 90,
            },
        ]);
    });

    test("the curve is read through basisCurve when the edge is a trimmed one", () => {
        // A trimmed curve reports its own type, not the circle's, so an arc read off the
        // outer curve would fall through to sampling and arrive as 64 short lines.
        const edge = edgeOf(
            { curveType: "trimmed", basisCurve: { ...circle(0, 0, 10), curveType: "circle" } },
            at(10, 0),
            at(0, 10),
        );
        expect(read(edge)[0].kind).toBe("arc");
    });

    test("a curve DrawItem cannot name is sampled into a polyline", () => {
        const points = [at(0, 0), at(1, 1), at(2, 0)];
        const items = read(edgeOf({ curveType: "bspline" }, at(0, 0), at(2, 0), points));
        expect(items).toEqual([
            {
                kind: "polyline",
                layer: "WALL",
                points: [
                    { x: 0, y: 0 },
                    { x: 1000, y: 1000 },
                    { x: 2000, y: 0 },
                ],
                closed: false,
            },
        ]);
    });

    test("a closed sampled curve drops the repeated last point rather than closing onto it", () => {
        // A DrawItem polyline repeats nothing and sets `closed` instead, so leaving the
        // sampler's duplicate in place would close the run onto a zero-length edge.
        const points = [at(0, 0), at(1, 1), at(2, 0), at(0, 0)];
        const items = read(edgeOf({ curveType: "bspline" }, at(0, 0), at(0, 0), points));
        const polyline = items[0] as Extract<DrawItem, { kind: "polyline" }>;
        expect(polyline.closed).toBe(true);
        expect(polyline.points).toHaveLength(3);
    });

    test("an elliptical arc is sampled rather than quietly closed into a whole ellipse", () => {
        // DrawItem's ellipse is a whole ellipse at a rotation. It has nowhere to put a
        // trim, so reading one as an ellipse would draw the three quarters that were
        // never there.
        const ellipse = {
            curveType: "ellipse",
            center: at(0, 0),
            majorRadius: 10,
            minorRadius: 5,
            xAxis: at(1, 0),
            axis: at(0, 0, 1),
        };
        const items = read(edgeOf(ellipse, at(10, 0), at(0, 5), [at(10, 0), at(7, 3), at(0, 5)]));
        expect(items[0].kind).toBe("polyline");
    });

    test("a whole ellipse keeps its two radii and its rotation", () => {
        const ellipse = {
            curveType: "ellipse",
            center: at(1, 1),
            majorRadius: 10,
            minorRadius: 5,
            xAxis: at(0, 1),
            axis: at(0, 0, 1),
        };
        const items = read(edgeOf(ellipse, at(1, 11), at(1, 11)));
        expect(items).toEqual([
            {
                kind: "ellipse",
                layer: "WALL",
                center: { x: 1000, y: 1000 },
                radiusXMm: 10000,
                radiusYMm: 5000,
                rotationDeg: 90,
            },
        ]);
    });

    test("a sampled curve with nothing to sample is dropped rather than emitted empty", () => {
        expect(read(edgeOf({ curveType: "bspline" }, at(0, 0), at(1, 0), []))).toEqual([]);
    });
});
