import { UnitSetup } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { generatorContext } from "./aiContext";

// Generators speak millimetres and the document speaks its own base unit. Everything
// here guards that boundary: get it wrong in one direction and every plan comes out
// 25.4x or 1000x the size it should be, which is the loudest way this feature can fail.

describe("an architectural drawing counted in inches", () => {
    const ctx = () => {
        UnitSetup.configure({ type: "architectural", baseUnit: "in", precision: 16 });
        return generatorContext();
    };

    test("a 30 foot plot typed by the draftsman becomes 9144 mm", () => {
        expect(ctx().parseLength("30'")).toBeCloseTo(9144);
    });

    test("feet and inches are understood as written", () => {
        expect(ctx().parseLength(`29'-6"`)).toBeCloseTo(8991.6);
    });

    test("a room the generator sizes in millimetres reads back in feet and inches", () => {
        expect(ctx().format(9144)).toBe(`30'-0"`);
    });

    test("nonsense is refused rather than silently becoming zero", () => {
        expect(ctx().parseLength("wide-ish")).toBeUndefined();
    });
});

describe("a metric drawing counted in millimetres", () => {
    const ctx = () => {
        UnitSetup.configure({ type: "decimal", baseUnit: "mm", precision: 0 });
        return generatorContext();
    };

    test("a bare number is taken at face value", () => {
        expect(ctx().parseLength("9000")).toBeCloseTo(9000);
    });

    test("feet still parse, because the draftsman may type either", () => {
        expect(ctx().parseLength("30'")).toBeCloseTo(9144);
    });

    test("sizes read back as plain millimetres", () => {
        expect(ctx().format(3600)).toBe("3600");
    });
});

test("a drawing counted in metres scales, it does not relabel", () => {
    UnitSetup.configure({ type: "decimal", baseUnit: "m", precision: 3 });
    const ctx = generatorContext();
    // 9000 in a metre drawing means 9000 metres - the document's unit decides, not the
    // generator, which is exactly why parsing is injected rather than done inside it.
    expect(ctx.parseLength("9000")).toBeCloseTo(9_000_000);
    expect(ctx.format(9000)).toBe("9.000");
});

test("parsing and formatting are inverses in every base unit", () => {
    for (const baseUnit of ["mm", "cm", "m", "in", "ft"] as const) {
        UnitSetup.configure({ type: "decimal", baseUnit, precision: 6 });
        const ctx = generatorContext();
        const text = ctx.format(12345);
        expect(ctx.parseLength(text), baseUnit).toBeCloseTo(12345, 3);
    }
});
