// The dimension style *table* - the five operations the Dimension Style Manager's
// buttons perform, and the invariants that keep a dimension drawable whatever the table
// has been done to. A dimension that cannot resolve a style cannot be drawn at all, so
// the fallbacks here matter more than the happy paths.

import { expect, test } from "@rstest/core";
import { ObjectStorage } from "../objectStorage";
import {
    DECIMAL_SEPARATORS,
    DEFAULT_DIMENSION_SETTINGS,
    LINE_WEIGHT_BY_BLOCK,
    LINE_WEIGHT_BY_LAYER,
    LINE_WEIGHT_DEFAULT,
    pixelsForLineWeight,
    resolveDimensionLineType,
    uniqueStyleName,
    validateStyleName,
} from "./dimensionStyle";
import { DimensionSetup } from "./drawingSetup";

/** A table holding nothing but a default Standard, as a fresh drawing has. */
function resetTable() {
    ObjectStorage.default.remove("dimensionStyles");
    ObjectStorage.default.remove("dimensionSetup");
    ObjectStorage.default.setValue("dimensionStyles", {
        current: "Standard",
        styles: [{ ...DEFAULT_DIMENSION_SETTINGS }],
    });
    DimensionSetup.restore();
}

test("a new style copies the one it is based on rather than the defaults", () => {
    resetTable();
    DimensionSetup.configure({ textHeight: 7 });

    DimensionSetup.createStyle("Arch", "Standard");

    expect(DimensionSetup.style("Arch")?.textHeight).toBe(7);
    // Creating does not switch to it, as AutoCAD's New does not either.
    expect(DimensionSetup.currentStyleName).toBe("Standard");
});

test("setting a style current changes what new dimensions are drawn in", () => {
    resetTable();
    DimensionSetup.createStyle("Arch");
    DimensionSetup.modify("Arch", { textHeight: 12 });

    expect(DimensionSetup.setCurrent("Arch")).toBe(true);

    expect(DimensionSetup.currentStyleName).toBe("Arch");
    expect(DimensionSetup.settings.textHeight).toBe(12);
});

test("modifying one style leaves the others alone", () => {
    resetTable();
    DimensionSetup.createStyle("Arch");

    DimensionSetup.modify("Arch", { arrowSize: 9 });

    expect(DimensionSetup.style("Arch")?.arrowSize).toBe(9);
    expect(DimensionSetup.style("Standard")?.arrowSize).toBe(DEFAULT_DIMENSION_SETTINGS.arrowSize);
});

test("an override rides on top of the current style without being saved into it", () => {
    resetTable();

    DimensionSetup.setOverride({ textHeight: 99 });

    expect(DimensionSetup.hasOverride).toBe(true);
    // What new dimensions get...
    expect(DimensionSetup.settings.textHeight).toBe(99);
    // ...but the style itself is untouched, which is the whole distinction.
    expect(DimensionSetup.style("Standard")?.textHeight).toBe(DEFAULT_DIMENSION_SETTINGS.textHeight);
});

test("an override matching the style in every value is no override at all", () => {
    resetTable();

    DimensionSetup.setOverride({ textHeight: DEFAULT_DIMENSION_SETTINGS.textHeight });

    expect(DimensionSetup.hasOverride).toBe(false);
});

test("saving an override folds it into the current style and clears it", () => {
    resetTable();
    DimensionSetup.setOverride({ textHeight: 99 });

    DimensionSetup.saveOverrideToStyle();

    expect(DimensionSetup.hasOverride).toBe(false);
    expect(DimensionSetup.style("Standard")?.textHeight).toBe(99);
});

test("setting a style current discards the override, as AutoCAD does", () => {
    resetTable();
    DimensionSetup.createStyle("Arch");
    DimensionSetup.setOverride({ textHeight: 99 });

    DimensionSetup.setCurrent("Arch");

    expect(DimensionSetup.hasOverride).toBe(false);
});

test("compare reports the settings two styles disagree on, and not their names", () => {
    resetTable();
    DimensionSetup.createStyle("Arch");
    DimensionSetup.modify("Arch", { textHeight: 12, arrowSize: 9 });

    const differences = DimensionSetup.compare("Standard", "Arch");

    expect(differences.map((d) => d.key).sort()).toEqual(["arrowSize", "textHeight"]);
    expect(differences.find((d) => d.key === "textHeight")).toEqual({
        key: "textHeight",
        first: DEFAULT_DIMENSION_SETTINGS.textHeight,
        second: 12,
    });
});

test("two identical styles compare as no differences at all", () => {
    resetTable();
    DimensionSetup.createStyle("Copy");

    expect(DimensionSetup.compare("Standard", "Copy")).toEqual([]);
});

test("Standard and the current style refuse to be deleted", () => {
    resetTable();
    DimensionSetup.createStyle("Arch");
    DimensionSetup.setCurrent("Arch");

    // Standard is the floor the table cannot go below...
    expect(DimensionSetup.deleteStyle("Standard")).toBe(false);
    // ...and deleting what is current would leave new dimensions with no style.
    expect(DimensionSetup.deleteStyle("Arch")).toBe(false);
    expect(DimensionSetup.styleNames).toEqual(["Arch", "Standard"]);
});

test("a dimension naming a deleted style still draws, in the current style", () => {
    resetTable();
    DimensionSetup.createStyle("Doomed");
    DimensionSetup.modify("Doomed", { textHeight: 40 });
    DimensionSetup.configure({ textHeight: 3 });

    expect(DimensionSetup.deleteStyle("Doomed")).toBe(true);

    // Not undefined, and not a throw: a dimension that cannot resolve its style is a
    // dimension that cannot be rendered, which is never the right answer.
    expect(DimensionSetup.styleFor("Doomed").textHeight).toBe(3);
});

test("a dimension naming no style follows whichever style is current", () => {
    resetTable();
    DimensionSetup.createStyle("Arch");
    DimensionSetup.modify("Arch", { textHeight: 12 });
    DimensionSetup.setCurrent("Arch");

    expect(DimensionSetup.styleFor(undefined).textHeight).toBe(12);
});

test("style names compare case-insensitively, as AutoCAD's symbol table does", () => {
    resetTable();
    DimensionSetup.createStyle("Arch");

    expect(DimensionSetup.style("ARCH")).toBeDefined();
    expect(DimensionSetup.setCurrent("arch")).toBe(true);
    // A second "arch" would be the same style, so New lands on a free name instead.
    expect(DimensionSetup.createStyle("ARCH")).not.toBe("ARCH");
});

test("renaming a style follows the current pointer across", () => {
    resetTable();
    DimensionSetup.createStyle("Old");
    DimensionSetup.setCurrent("Old");

    DimensionSetup.modify("Old", { name: "New" });

    expect(DimensionSetup.currentStyleName).toBe("New");
    expect(DimensionSetup.style("Old")).toBeUndefined();
    expect(DimensionSetup.style("New")).toBeDefined();
});

test("Standard cannot be renamed out from under the drawings that name it", () => {
    resetTable();

    DimensionSetup.modify("Standard", { name: "Something Else", textHeight: 5 });

    expect(DimensionSetup.style("Standard")?.name).toBe("Standard");
    // The rename is refused; the rest of the edit still lands.
    expect(DimensionSetup.style("Standard")?.textHeight).toBe(5);
});

test("the table survives a reload with every style and the current pointer intact", () => {
    resetTable();
    DimensionSetup.createStyle("Arch");
    DimensionSetup.modify("Arch", { textHeight: 12 });
    DimensionSetup.setCurrent("Arch");

    expect(DimensionSetup.restore()).toBe(true);

    expect(DimensionSetup.styleNames).toEqual(["Arch", "Standard"]);
    expect(DimensionSetup.currentStyleName).toBe("Arch");
    expect(DimensionSetup.style("Arch")?.textHeight).toBe(12);
});

test("an override is not carried across a reload", () => {
    resetTable();
    DimensionSetup.setOverride({ textHeight: 99 });

    DimensionSetup.restore();

    expect(DimensionSetup.hasOverride).toBe(false);
});

test("a stored table with no Standard gains one rather than leaving the drawing styleless", () => {
    ObjectStorage.default.remove("dimensionStyles");
    ObjectStorage.default.setValue("dimensionStyles", {
        current: "Arch",
        styles: [{ ...DEFAULT_DIMENSION_SETTINGS, name: "Arch" }],
    });

    expect(DimensionSetup.restore()).toBe(true);

    expect(DimensionSetup.styleNames).toEqual(["Arch", "Standard"]);
    expect(DimensionSetup.currentStyleName).toBe("Arch");
});

test("a hand-edited table drops the styles it cannot make sense of", () => {
    ObjectStorage.default.remove("dimensionStyles");
    ObjectStorage.default.setValue("dimensionStyles", {
        current: "Ghost",
        styles: [
            { ...DEFAULT_DIMENSION_SETTINGS },
            // No name at all - would otherwise land on the default name and silently
            // overwrite Standard.
            { ...DEFAULT_DIMENSION_SETTINGS, name: undefined },
            { ...DEFAULT_DIMENSION_SETTINGS, name: "Bad/Name" },
        ],
    });

    expect(DimensionSetup.restore()).toBe(true);

    expect(DimensionSetup.styleNames).toEqual(["Standard"]);
    // "Ghost" did not survive either, so current falls back rather than dangling.
    expect(DimensionSetup.currentStyleName).toBe("Standard");
});

test("style names are rejected for the reason they are wrong", () => {
    expect(validateStyleName("", [])).toBe("empty");
    expect(validateStyleName("   ", [])).toBe("empty");
    expect(validateStyleName("a".repeat(256), [])).toBe("tooLong");
    expect(validateStyleName("Arch/Plan", [])).toBe("invalidChars");
    expect(validateStyleName("Arch", ["Arch"])).toBe("duplicate");
    expect(validateStyleName("arch", ["Arch"])).toBe("duplicate");
    expect(validateStyleName("Arch", [])).toBeUndefined();
    // Renaming a style is allowed to keep its own name, including re-casing it.
    expect(validateStyleName("Arch", ["Arch"], "Arch")).toBeUndefined();
    expect(validateStyleName("ARCH", ["Arch"], "Arch")).toBeUndefined();
});

test("a copy is named after its parent, and numbered once that is taken", () => {
    expect(uniqueStyleName("Standard", ["Standard"])).toBe("Standard copy");
    expect(uniqueStyleName("Standard", ["Standard", "Standard copy"])).toBe("Standard copy 2");
    expect(uniqueStyleName("Standard", ["Standard", "Standard copy", "Standard copy 2"])).toBe(
        "Standard copy 3",
    );
});

test("a lineweight off the ladder snaps to the nearest rung", () => {
    resetTable();

    // What an imported DXF can carry: a width no AutoCAD dropdown offers.
    DimensionSetup.configure({ dimLineWeight: 0.135 });
    expect(DimensionSetup.settings.dimLineWeight).toBe(0.13);

    DimensionSetup.configure({ dimLineWeight: 0.33 });
    expect(DimensionSetup.settings.dimLineWeight).toBe(0.35);

    // Above the top rung it lands on the top rung rather than running off the end.
    DimensionSetup.configure({ dimLineWeight: 50 });
    expect(DimensionSetup.settings.dimLineWeight).toBe(2.11);
});

test("the inherited lineweights survive validation rather than being snapped away", () => {
    resetTable();

    // -1/-2/-3 are meaningful, not malformed - a `positive` check would have eaten them.
    for (const inherited of [LINE_WEIGHT_BY_LAYER, LINE_WEIGHT_BY_BLOCK, LINE_WEIGHT_DEFAULT]) {
        DimensionSetup.configure({ dimLineWeight: inherited });
        expect(DimensionSetup.settings.dimLineWeight).toBe(inherited);
    }

    // Any other negative is nonsense and falls back to what was there.
    DimensionSetup.configure({ dimLineWeight: 0.25 });
    DimensionSetup.configure({ dimLineWeight: -99 });
    expect(DimensionSetup.settings.dimLineWeight).toBe(0.25);
});

test("inherited lineweights all draw at the same default width", () => {
    // Nothing here has a block or a layer to inherit from, so all three resolve alike -
    // and to the one-pixel line the renderer drew before lineweights existed.
    expect(pixelsForLineWeight(LINE_WEIGHT_BY_BLOCK)).toBe(1);
    expect(pixelsForLineWeight(LINE_WEIGHT_BY_LAYER)).toBe(1);
    expect(pixelsForLineWeight(LINE_WEIGHT_DEFAULT)).toBe(1);
    // A real width scales from there: 0.50mm is twice 0.25mm.
    expect(pixelsForLineWeight(0.5)).toBe(2);
});

test("the inherited linetypes draw as a continuous line", () => {
    expect(resolveDimensionLineType("byBlock")).toBe("solid");
    expect(resolveDimensionLineType("byLayer")).toBe("solid");
    // The concrete ones pass through as the renderer's own names.
    expect(resolveDimensionLineType("hidden")).toBe("hidden");
});

test("a bad linetype falls back rather than landing on a pattern nobody chose", () => {
    resetTable();

    DimensionSetup.configure({ dimLineType: "dash" });
    DimensionSetup.configure({ dimLineType: "squiggle" as never });

    expect(DimensionSetup.settings.dimLineType).toBe("dash");
});

test("the decimal separator takes only the three the dropdown offers", () => {
    resetTable();

    for (const separator of DECIMAL_SEPARATORS) {
        DimensionSetup.configure({ decimalSeparator: separator });
        expect(DimensionSetup.settings.decimalSeparator).toBe(separator);
    }

    // A single character that is not one of the three - which a style saved while this
    // was a free-text box could well hold - falls back rather than sticking around as a
    // value the dropdown cannot show.
    DimensionSetup.configure({ decimalSeparator: "." });
    DimensionSetup.configure({ decimalSeparator: "Z" as never });
    expect(DimensionSetup.settings.decimalSeparator).toBe(".");
});
