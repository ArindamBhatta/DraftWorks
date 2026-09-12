import { type IConverter, Result, UnitSetup } from "@draftworks/core";

/**
 * A distance in the drawing's own unit format, both ways: a radius shows as 8'-4" in an
 * architectural drawing and accepts 8'-4", 100 or 8.3333' back.
 *
 * The difference from NumberConverter is what the number means. A count of sides or a
 * rotation in degrees is a number and should stay one; a radius, a width, a coordinate
 * is a length, and a palette that renders one of those raw while a coordinate two rows
 * up reads in feet and inches is telling the user the drawing has two unit systems.
 */
export class LengthConverter implements IConverter<number> {
    convert(value: number): Result<string> {
        return Number.isNaN(value) ? Result.err("Number is NaN") : Result.ok(UnitSetup.formatLength(value));
    }

    convertBack(value: string): Result<number> {
        const length = UnitSetup.tryParseLength(value);
        return length === undefined ? Result.err(`${value} is not a length`) : Result.ok(length);
    }
}
