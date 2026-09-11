// The Primary Units, Alternate Units and Tolerances tabs of DIMSTYLE do not move a single
// line - they change what a measurement *reads* as. These pin down that pipeline: the
// order the rules apply in (round, then format, then suppress zeros, then swap the
// separator), and what each tab's settings actually produce.

import { expect, test } from "@rstest/core";
import { DEFAULT_DIMENSION_SETTINGS, type DimensionSettings } from "./dimensionStyle";
import { flattenDimensionLabel, formatDimensionLabel } from "./dimensionText";
import { UnitSetup } from "./unitSetup";

/** A decimal-millimetre drawing at two places - the plainest base to vary one thing from. */
const style = (overrides: Partial<DimensionSettings> = {}): DimensionSettings => {
    UnitSetup.configure({ type: "decimal", precision: 2, baseUnit: "mm" });
    return { ...DEFAULT_DIMENSION_SETTINGS, precision: 2, ...overrides };
};

const textOf = (value: number, overrides: Partial<DimensionSettings> = {}, kind?: "length" | "angle") =>
    flattenDimensionLabel(formatDimensionLabel(value, style(overrides), kind ?? "length"));

test("a plain length formats at the style's precision", () => {
    expect(textOf(125)).toBe("125.00");
});

test("DIMPOST wraps the measurement without disturbing it", () => {
    expect(textOf(125, { prefix: "≈", suffix: " mm" })).toBe("≈125.00 mm");
});

test("a type's own marker stays attached to its number, inside the style's affixes", () => {
    const label = formatDimensionLabel(25, style({ suffix: " mm" }), "length", "R");
    expect(label.text).toBe("R25.00 mm");
});

test("DIMLFAC scales what is reported without touching what was measured", () => {
    expect(textOf(100, { measurementScale: 0.5 })).toBe("50.00");
});

test("DIMRND rounds to an increment, not to a number of places", () => {
    expect(textOf(127, { roundOff: 5 })).toBe("125.00");
    expect(textOf(128, { roundOff: 5 })).toBe("130.00");
});

test("rounding happens before formatting, so precision cannot undo it", () => {
    expect(textOf(1.24, { roundOff: 0.5, precision: 2 })).toBe("1.00");
});

test("DIMZIN drops the zeros it is asked to and no others", () => {
    expect(textOf(0.5, { suppressLeadingZeros: true })).toBe(".50");
    expect(textOf(12.5, { suppressTrailingZeros: true })).toBe("12.5");
    expect(textOf(12, { suppressTrailingZeros: true })).toBe("12");
    // A whole number has no trailing zeros to lose - only decimals do.
    expect(textOf(120, { suppressTrailingZeros: true })).toBe("120");
});

test("DIMDSEP replaces the decimal point after the zero rules have run", () => {
    expect(textOf(12.5, { decimalSeparator: ",", suppressTrailingZeros: true })).toBe("12,5");
});

test("angles format in whichever angular unit DIMAUNIT asks for", () => {
    expect(textOf(45, {}, "angle")).toBe("45.00°");
    expect(textOf(45, { angularFormat: "gradians" }, "angle")).toBe("50.00g");
    expect(textOf(45, { angularFormat: "radians", angularPrecision: 4 }, "angle")).toBe("0.7854r");
});

test("degrees/minutes/seconds carries upward instead of printing 60", () => {
    // 45.9999999 degrees is 59'59.9996", which rounds at two places to 60.00" - and has
    // to become the next minute rather than render as an impossible reading.
    const text = textOf(45.9999999, { angularFormat: "degreesMinutesSeconds" }, "angle");
    expect(text).not.toContain('60.00"');
    expect(text).toBe("46°00'0.00\"");
});

test("alternate units convert, and sit beside or below the primary as asked", () => {
    const inline = formatDimensionLabel(
        10,
        style({ alternateEnabled: true, alternateMultiplier: 0.0393701, alternatePrecision: 3 }),
    );
    expect(inline.text).toBe("10.00 [0.394]");
    expect(inline.secondary).toBeUndefined();

    const below = formatDimensionLabel(
        10,
        style({
            alternateEnabled: true,
            alternateMultiplier: 0.0393701,
            alternatePrecision: 3,
            alternatePlacement: "below",
        }),
    );
    expect(below.text).toBe("10.00");
    expect(below.secondary).toBe("[0.394]");
});

test("alternate units are left off angles, which have no conversion factor", () => {
    const label = formatDimensionLabel(45, style({ alternateEnabled: true }), "angle");
    expect(label.text).toBe("45.00°");
    expect(label.secondary).toBeUndefined();
});

test("a symmetrical tolerance is one ± line, and vanishes when it is zero", () => {
    const withTolerance = formatDimensionLabel(
        50,
        style({ toleranceMethod: "symmetrical", toleranceUpper: 0.25 }),
    );
    expect(withTolerance.tolerance).toEqual({ upper: "±0.25" });

    const zero = formatDimensionLabel(50, style({ toleranceMethod: "symmetrical", toleranceUpper: 0 }));
    expect(zero.tolerance).toBeUndefined();
});

test("a deviation tolerance stacks a signed pair, subtracting the lower value", () => {
    const label = formatDimensionLabel(
        50,
        style({ toleranceMethod: "deviation", toleranceUpper: 0.5, toleranceLower: 0.25 }),
    );
    expect(label.tolerance).toEqual({ upper: "+0.50", lower: "-0.25" });
    expect(label.text).toBe("50.00");
});

test("limits replace the measurement with the two extreme sizes", () => {
    const label = formatDimensionLabel(
        50,
        style({ toleranceMethod: "limits", toleranceUpper: 0.5, toleranceLower: 0.25 }),
    );
    expect(label.text).toBe("");
    expect(label.tolerance).toEqual({ upper: "50.50", lower: "49.75" });
    // Flattened for the DXF exporter, which has nowhere to stack them.
    expect(flattenDimensionLabel(label)).toBe("50.50/49.75");
});

test("a basic tolerance boxes the measurement and adds nothing to it", () => {
    const label = formatDimensionLabel(50, style({ toleranceMethod: "basic" }));
    expect(label.boxed).toBe(true);
    expect(label.text).toBe("50.00");
    expect(label.tolerance).toBeUndefined();
});

test("tolerances are left off angles", () => {
    const label = formatDimensionLabel(
        45,
        style({ toleranceMethod: "symmetrical", toleranceUpper: 1 }),
        "angle",
    );
    expect(label.tolerance).toBeUndefined();
});

test("an architectural drawing suppresses zero feet rather than a leading digit", () => {
    UnitSetup.configure({ type: "architectural", precision: 16, baseUnit: "in" });
    const settings = { ...DEFAULT_DIMENSION_SETTINGS, precision: 16, suppressLeadingZeros: true };

    expect(flattenDimensionLabel(formatDimensionLabel(6, settings))).toBe('6"');
});
