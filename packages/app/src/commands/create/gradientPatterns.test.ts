// A gradient's angle is the one part of GRADIENT that can be quietly wrong: a ramp built
// on the wrong sign or the wrong extent still looks like a gradient, just not the one
// that was asked for. These pin the two things that would go unnoticed - which way the
// angle turns, and that a diagonal ramp still spans the whole tile.

import { expect, test } from "@rstest/core";
import { linearRampEnds } from "./gradientPatterns";

test("0 degrees runs left to right across the tile", () => {
    const { x0, y0, x1, y1 } = linearRampEnds(100, 0);
    expect(x0).toBeCloseTo(0);
    expect(x1).toBeCloseTo(100);
    expect(y0).toBeCloseTo(50);
    expect(y1).toBeCloseTo(50);
});

test("90 degrees runs bottom to top, against the canvas's downward y", () => {
    const { x0, y0, x1, y1 } = linearRampEnds(100, 90);
    expect(y0).toBeCloseTo(100);
    expect(y1).toBeCloseTo(0);
    expect(x0).toBeCloseTo(50);
    expect(x1).toBeCloseTo(50);
});

test("45 degrees runs corner to corner rather than stopping short", () => {
    const { x0, y0, x1, y1 } = linearRampEnds(100, 45);
    expect(x0).toBeCloseTo(0);
    expect(y0).toBeCloseTo(100);
    expect(x1).toBeCloseTo(100);
    expect(y1).toBeCloseTo(0);
});

test("a ramp and its opposite cover the same span, end for end", () => {
    const forward = linearRampEnds(256, 30);
    const backward = linearRampEnds(256, 210);
    expect(backward.x0).toBeCloseTo(forward.x1);
    expect(backward.y0).toBeCloseTo(forward.y1);
    expect(backward.x1).toBeCloseTo(forward.x0);
    expect(backward.y1).toBeCloseTo(forward.y0);
});
