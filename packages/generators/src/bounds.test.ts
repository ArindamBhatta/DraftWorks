import { expect, test } from "@rstest/core";
import { boundsOf, type DrawItem } from "./types";

test("a circle is bounded by its extent, not by its centre", () => {
    const bounds = boundsOf([{ kind: "circle", layer: "A", center: { x: 10, y: 10 }, radiusMm: 4 }]);

    expect(bounds.min).toEqual({ x: 6, y: 6 });
    expect(bounds.max).toEqual({ x: 14, y: 14 });
});

test("an unrotated ellipse is bounded by its two radii", () => {
    const bounds = boundsOf([
        { kind: "ellipse", layer: "A", center: { x: 0, y: 0 }, radiusXMm: 10, radiusYMm: 4, rotationDeg: 0 },
    ]);

    expect(bounds.min.x).toBeCloseTo(-10);
    expect(bounds.max.y).toBeCloseTo(4);
});

test("a rotated ellipse is bounded by where it actually reaches", () => {
    const bounds = boundsOf([
        { kind: "ellipse", layer: "A", center: { x: 0, y: 0 }, radiusXMm: 10, radiusYMm: 4, rotationDeg: 90 },
    ]);

    // Turned a quarter turn, the long axis is now vertical - so the box swaps too.
    expect(bounds.max.x).toBeCloseTo(4);
    expect(bounds.max.y).toBeCloseTo(10);
});

test("a 45 degree ellipse reaches past both of its radii", () => {
    const bounds = boundsOf([
        { kind: "ellipse", layer: "A", center: { x: 0, y: 0 }, radiusXMm: 10, radiusYMm: 4, rotationDeg: 45 },
    ]);

    expect(bounds.max.x).toBeGreaterThan(4);
    expect(bounds.max.x).toBeLessThan(10);
    expect(bounds.max.x).toBeCloseTo(Math.hypot(10 * Math.SQRT1_2, 4 * Math.SQRT1_2));
});

test("a polyline includes every point, not just its ends", () => {
    const bounds = boundsOf([
        {
            kind: "polyline",
            layer: "A",
            points: [
                { x: 0, y: 0 },
                { x: 5, y: 90 },
                { x: 10, y: 0 },
            ],
            closed: true,
        },
    ]);

    expect(bounds.max).toEqual({ x: 10, y: 90 });
});

test("mixed primitives share one box", () => {
    const items: DrawItem[] = [
        { kind: "line", layer: "A", a: { x: -5, y: 0 }, b: { x: 0, y: 0 } },
        { kind: "circle", layer: "A", center: { x: 20, y: 0 }, radiusMm: 3 },
    ];

    expect(boundsOf(items)).toEqual({ min: { x: -5, y: -3 }, max: { x: 23, y: 3 } });
});
