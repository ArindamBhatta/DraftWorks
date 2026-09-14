// What RECTANG's Fillet/Chamfer sub-prompt accepts. Zero is the case that matters:
// unlike an offset distance it is a real answer, because it is how square corners
// come back after a radius has been set.

import { expect, test } from "@rstest/core";
import { parseSetback } from "./rect";

test("enter alone keeps the remembered value, AutoCAD's <...>", () => {
    const parsed = parseSetback("", 12.5);

    expect(parsed.isOk).toBe(true);
    expect(parsed.value).toBeCloseTo(12.5);
});

test("zero is accepted - it is how square corners come back", () => {
    const parsed = parseSetback("0", 12.5);

    expect(parsed.isOk).toBe(true);
    expect(parsed.value).toBeCloseTo(0);
});

test("a typed distance replaces the remembered one", () => {
    const parsed = parseSetback("25", 12.5);

    expect(parsed.isOk).toBe(true);
    expect(parsed.value).toBeCloseTo(25);
});

test("a negative setback is refused rather than silently clamped", () => {
    expect(parseSetback("-5", 12.5).isOk).toBe(false);
});

test("text that is not a length is refused", () => {
    expect(parseSetback("wide", 12.5).isOk).toBe(false);
});
