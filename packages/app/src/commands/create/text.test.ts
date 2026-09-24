// The height and rotation prompts both accept "just press Enter", so the difference
// between "keep the remembered value" and "reject this" has to be exact - getting it
// wrong either drops text at size zero or refuses a legitimate angle.

import { UnitSetup } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { parseTextHeight, parseTextRotation } from "./text";

test("a typed height is read in the drawing's units", () => {
    expect(parseTextHeight("5", 2.5)).toBe(5);

    const previous = UnitSetup.settings;
    UnitSetup.configure({ type: "architectural", baseUnit: "in" });
    try {
        expect(parseTextHeight(`1'`, 2.5)).toBe(12);
    } finally {
        UnitSetup.configure(previous);
    }
});

test("an empty height keeps the remembered one", () => {
    expect(parseTextHeight("", 2.5)).toBe(2.5);
    expect(parseTextHeight("   ", 7)).toBe(7);
});

test("heights of zero or less are rejected rather than clamped", () => {
    expect(parseTextHeight("0", 2.5)).toBeUndefined();
    expect(parseTextHeight("-3", 2.5)).toBeUndefined();
    expect(parseTextHeight("", 0)).toBeUndefined();
});

test("text that is not a length is rejected", () => {
    expect(parseTextHeight("big", 2.5)).toBeUndefined();
});

test("rotation takes any finite angle, including negative and past a full turn", () => {
    expect(parseTextRotation("45", 0)).toBe(45);
    expect(parseTextRotation("-90", 0)).toBe(-90);
    expect(parseTextRotation("450", 0)).toBe(450);
    expect(parseTextRotation("22.5", 0)).toBe(22.5);
    expect(parseTextRotation(".5", 0)).toBe(0.5);
});

test("an empty rotation keeps the remembered angle, zero included", () => {
    expect(parseTextRotation("", 30)).toBe(30);
    expect(parseTextRotation("", 0)).toBe(0);
});

test("rotation rejects anything that is not a plain number", () => {
    expect(parseTextRotation("45deg", 0)).toBeUndefined();
    expect(parseTextRotation("abc", 0)).toBeUndefined();
    expect(parseTextRotation("1e3", 0)).toBeUndefined();
});
