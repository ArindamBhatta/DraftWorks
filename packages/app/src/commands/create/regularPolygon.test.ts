// POLYGON's two questions before anything is drawn: how many sides, and whether the
// radius reaches a corner or the middle of a side. The second changes the shape a given
// radius produces, which is the part worth pinning.

import { expect, test } from "@rstest/core";
import { MaxPolygonSides, MinPolygonSides, parseSides, vertexRadius } from "./regularPolygon";

test("enter alone keeps the remembered side count", () => {
    const parsed = parseSides("", 6);

    expect(parsed.isOk).toBe(true);
    expect(parsed.value).toBe(6);
});

test("a typed count replaces it", () => {
    const parsed = parseSides("8", 6);

    expect(parsed.isOk).toBe(true);
    expect(parsed.value).toBe(8);
});

test("fewer than three sides is not a polygon", () => {
    expect(parseSides("2", 6).isOk).toBe(false);
    expect(parseSides("0", 6).isOk).toBe(false);
    expect(parseSides(String(MinPolygonSides), 6).isOk).toBe(true);
});

test("a fractional count is refused rather than rounded behind the user's back", () => {
    // parseInt would take "3.5" as 3 and draw a triangle without saying why.
    expect(parseSides("3.5", 6).isOk).toBe(false);
});

test("a negative or non-numeric count is refused", () => {
    expect(parseSides("-4", 6).isOk).toBe(false);
    expect(parseSides("six", 6).isOk).toBe(false);
});

test("an absurd count is refused rather than locking up the kernel", () => {
    expect(parseSides(String(MaxPolygonSides), 6).isOk).toBe(true);
    expect(parseSides(String(MaxPolygonSides + 1), 6).isOk).toBe(false);
});

test("an inscribed pick is already the vertex radius", () => {
    // The corner is what was picked, so nothing is converted.
    expect(vertexRadius(100, 6, "option.polygon.fit.inscribed")).toBeCloseTo(100);
});

test("a circumscribed pick is the middle of a side, so the corners sit further out", () => {
    // For a hexagon the side midpoint is cos(30) = 0.866 of the way to a corner, so a
    // 100 pick means corners at 100/0.866 = 115.47.
    expect(vertexRadius(100, 6, "option.polygon.fit.circumscribed")).toBeCloseTo(115.4700538);

    // A square: the midpoint is cos(45) of the corner distance.
    expect(vertexRadius(100, 4, "option.polygon.fit.circumscribed")).toBeCloseTo(141.4213562);
});

test("the two fits agree only in the limit of many sides", () => {
    // As n grows the polygon approaches its circle and the distinction fades - a useful
    // check that the conversion is the right way round rather than merely different.
    const few = vertexRadius(100, 3, "option.polygon.fit.circumscribed");
    const many = vertexRadius(100, 360, "option.polygon.fit.circumscribed");

    expect(few).toBeGreaterThan(many);
    expect(many).toBeCloseTo(100, 2);
});

test("a circumscribed polygon is always at least as big as an inscribed one", () => {
    // Same picked distance: the circumscribed one has to reach further to put its sides
    // where the inscribed one puts its corners.
    for (const sides of [3, 5, 6, 12]) {
        const inscribed = vertexRadius(50, sides, "option.polygon.fit.inscribed");
        const circumscribed = vertexRadius(50, sides, "option.polygon.fit.circumscribed");
        expect(circumscribed).toBeGreaterThan(inscribed);
    }
});
