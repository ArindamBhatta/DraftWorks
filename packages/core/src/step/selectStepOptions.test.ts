// A selection prompt used to take no typed input and offer no options, so a command
// with a setting - FILLET's radius - could only put it in the ribbon's property panel.
// The status bar said "Select edges", the command line took nothing, and the panel held
// the value: three surfaces, none of them agreeing. Point prompts had had options all
// along; only the selection ones were left out.
//
// These cover the matching a typed letter goes through, which is the half that decides
// whether `R` at the prompt reaches the radius or falls through to the hotkeys.

import { expect, test } from "@rstest/core";
import { matchStepOption, type StepOption } from "../snap";

const radius: StepOption = {
    key: "R",
    name: "prompt.optionName.radius",
    display: "prompt.option.radius",
    onSelect: () => {},
};

test("the option's own letter selects it, in either case", () => {
    // AutoCAD does not care which case an option is typed in, and neither should this.
    expect(matchStepOption([radius], "R")).toBe(radius);
    expect(matchStepOption([radius], "r")).toBe(radius);
});

test("a letter this prompt does not offer is left alone", () => {
    // It has to fall through rather than be swallowed: the selection keys and the
    // hotkeys beyond them still need to see it.
    expect(matchStepOption([radius], "X")).toBeUndefined();
});

test("a prompt with no options matches nothing", () => {
    // Every selection prompt that has not opted in, which is most of them.
    expect(matchStepOption(undefined, "R")).toBeUndefined();
    expect(matchStepOption([], "R")).toBeUndefined();
});

test("options are re-read from a provider, not snapshotted", () => {
    // The radius between the brackets has to be the radius now - including one just
    // typed at this same prompt - so the step holds a function, not a list.
    let current = 10;
    const provider = (): StepOption[] => [{ ...radius, display: `${current}` as never }];

    expect(matchStepOption(provider, "R")?.display).toBe("10");
    current = 25;
    expect(matchStepOption(provider, "R")?.display).toBe("25");
});
