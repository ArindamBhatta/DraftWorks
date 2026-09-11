import { type BaseUnit, UnitSetup } from "@chili3d/core";
import { expect, test } from "@rstest/core";
import { clamp, MM_PER_DRAWING_UNIT, mmToUnits, unitsToMm } from "./units";

const BASE_UNITS: BaseUnit[] = ["mm", "cm", "m", "in", "ft"];

// Core's INCHES_PER_UNIT is private, so this reaches it through the public parser:
// tryParseLength('1"', {baseUnit}) answers "how many drawing units is one inch", and one
// inch is 25.4 mm by definition. If core ever re-scales a base unit, this fails loudly
// rather than letting every generated drawing come out at the wrong size.
test("the millimetre table agrees with core's own unit scale", () => {
    for (const baseUnit of BASE_UNITS) {
        const unitsPerInch = UnitSetup.tryParseLength('1"', { baseUnit });
        if (unitsPerInch === undefined) throw new Error(`core cannot parse an inch in ${baseUnit}`);
        expect(MM_PER_DRAWING_UNIT[baseUnit]).toBeCloseTo(25.4 / unitsPerInch, 9);
    }
});

test("a metric drawing measures generator millimetres one for one", () => {
    expect(mmToUnits(9000, "mm")).toBeCloseTo(9000);
    expect(mmToUnits(9000, "m")).toBeCloseTo(9);
});

test("a 30 foot plot is 9144 mm however the drawing counts it", () => {
    expect(unitsToMm(30, "ft")).toBeCloseTo(9144);
    expect(unitsToMm(360, "in")).toBeCloseTo(9144);
    expect(mmToUnits(9144, "ft")).toBeCloseTo(30);
});

test("converting to drawing units and back is lossless", () => {
    for (const baseUnit of BASE_UNITS) {
        expect(unitsToMm(mmToUnits(12345, baseUnit), baseUnit)).toBeCloseTo(12345, 6);
    }
});

test("clamp holds a value inside its bounds", () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(-5, 1, 10)).toBe(1);
    expect(clamp(50, 1, 10)).toBe(10);
});
