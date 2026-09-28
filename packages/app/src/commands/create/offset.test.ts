// The opening OFFSET prompt is the one place the command reads free text, and the
// three answers it accepts (a length, Through, or Enter for the remembered default)
// all look alike from the call site. These pin down which is which.

import { UnitSetup } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { parseOffsetInput } from "./offset";

test("a typed length selects distance mode", () => {
    expect(parseOffsetInput("2.5", 1)).toEqual({ mode: "distance", distance: 2.5 });
});

test("lengths are read in the drawing's units", () => {
    const previous = UnitSetup.settings;
    UnitSetup.configure({ type: "architectural", baseUnit: "in" });
    try {
        expect(parseOffsetInput(`5'6"`, 1)).toEqual({ mode: "distance", distance: 66 });
    } finally {
        UnitSetup.configure(previous);
    }
});

test("T and Through both select through mode", () => {
    expect(parseOffsetInput("t", 1)).toEqual({ mode: "through" });
    expect(parseOffsetInput("T", 1)).toEqual({ mode: "through" });
    expect(parseOffsetInput("Through", 1)).toEqual({ mode: "through" });
});

test("an empty line accepts the remembered distance without changing it", () => {
    expect(parseOffsetInput("", 7)).toEqual({ mode: "distance" });
    expect(parseOffsetInput("   ", 7)).toEqual({ mode: "distance" });
});

test("an empty line is rejected when there is no remembered distance to fall back on", () => {
    expect(parseOffsetInput("", 0)).toBeUndefined();
});

test("zero and negative distances are rejected - the side is picked, not typed", () => {
    expect(parseOffsetInput("0", 1)).toBeUndefined();
    expect(parseOffsetInput("-3", 1)).toBeUndefined();
});

test("text that is not a length or an option is rejected", () => {
    expect(parseOffsetInput("erase", 1)).toBeUndefined();
    expect(parseOffsetInput("2,5", 1)).toBeUndefined();
});
