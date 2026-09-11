import type { BaseUnit } from "@chili3d/core";

/**
 * How many millimetres one drawing unit represents.
 *
 * One drawing unit is one UnitSetup.settings.baseUnit - that is what the drawing's
 * coordinates mean. Core knows the same fact as INCHES_PER_UNIT (inches per drawing
 * unit) in foundation/unitSetup/unitSetup.ts, but that table is private, so this package
 * keeps its own. units.test.ts cross-checks the two through the public parser, so if
 * core's table ever changes the test fails instead of every generated drawing silently
 * coming out 25.4x or 1000x wrong.
 *
 * Generators themselves work entirely in millimetres and never see this table; the
 * conversion happens once, at the boundary where DrawItems become nodes or SVG.
 */
export const MM_PER_DRAWING_UNIT: Record<BaseUnit, number> = {
    mm: 1,
    cm: 10,
    m: 1000,
    in: 25.4,
    ft: 304.8,
};

/** Converts a millimetre length from a generator into the drawing's own units. */
export function mmToUnits(mm: number, baseUnit: BaseUnit): number {
    return mm / MM_PER_DRAWING_UNIT[baseUnit];
}

/** Converts a length expressed in the drawing's units back to millimetres. */
export function unitsToMm(units: number, baseUnit: BaseUnit): number {
    return units * MM_PER_DRAWING_UNIT[baseUnit];
}

/** Clamps `value` into [lo, hi]. Used pervasively by the layout sizing rules. */
export function clamp(value: number, lo: number, hi: number): number {
    return Math.min(Math.max(value, lo), hi);
}

/** Lengths below this are treated as zero - see the degenerate-segment note in drawing.ts. */
export const LENGTH_EPSILON = 1e-6;
