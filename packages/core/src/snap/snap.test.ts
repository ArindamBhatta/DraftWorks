// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Typing an option at a prompt ("3P" at Specify center point) and clicking its chip
// in the status bar have to choose the same thing, so the typed side is matched
// through this one function. What it must and must not accept is easy to get subtly
// wrong - an empty line matching the first option would hijack bare Enter.

import { expect, test } from "@rstest/core";
import { hasStepOptions, matchStepOption, resolveStepOptions, type StepOption } from "./snap";

const noop = () => {};
const options: StepOption[] = [
    { key: "3P", display: "prompt.option.threePoint", onSelect: noop },
    { key: "2P", display: "prompt.option.twoPoint", onSelect: noop },
];

test("an exact key matches", () => {
    expect(matchStepOption(options, "3P")?.key).toBe("3P");
});

test("case does not matter - AutoCAD accepts an option however it is capitalised", () => {
    expect(matchStepOption(options, "3p")?.key).toBe("3P");
    expect(matchStepOption(options, "2p")?.key).toBe("2P");
});

test("surrounding whitespace is ignored", () => {
    expect(matchStepOption(options, "  3P  ")?.key).toBe("3P");
});

test("an empty line matches nothing, so bare Enter is still not an answer", () => {
    expect(matchStepOption(options, "")).toBeUndefined();
    expect(matchStepOption(options, "   ")).toBeUndefined();
});

test("a coordinate is not mistaken for an option", () => {
    expect(matchStepOption(options, "3")).toBeUndefined();
    expect(matchStepOption(options, "25.4")).toBeUndefined();
});

test("a prompt with no options matches nothing", () => {
    expect(matchStepOption(undefined, "3P")).toBeUndefined();
    expect(matchStepOption([], "3P")).toBeUndefined();
});

// A provider is what stops the prompt and the ribbon panel drifting apart: the
// options are re-asked on every refresh, so whichever surface changed the state,
// both end up showing what the command now actually holds.
test("a provider is re-asked, so the offer follows the current state", () => {
    let sizeMode = "radius";
    const options = () =>
        sizeMode === "radius"
            ? [{ key: "D", display: "prompt.option.diameter" as const, onSelect: noop }]
            : [{ key: "R", display: "prompt.option.radius" as const, onSelect: noop }];

    expect(resolveStepOptions(options).map((o) => o.key)).toEqual(["D"]);

    // Changed from anywhere - the prompt, a chip, the ribbon's dropdown.
    sizeMode = "diameter";
    expect(resolveStepOptions(options).map((o) => o.key)).toEqual(["R"]);
});

test("a provider's options are typeable too, at whatever it currently offers", () => {
    let sizeMode = "radius";
    const options = () =>
        sizeMode === "radius"
            ? [{ key: "D", display: "prompt.option.diameter" as const, onSelect: noop }]
            : [{ key: "R", display: "prompt.option.radius" as const, onSelect: noop }];

    expect(matchStepOption(options, "d")?.key).toBe("D");
    expect(matchStepOption(options, "r")).toBeUndefined();

    sizeMode = "diameter";
    expect(matchStepOption(options, "r")?.key).toBe("R");
    expect(matchStepOption(options, "d")).toBeUndefined();
});

test("resolving nothing gives an empty list, never undefined", () => {
    expect(resolveStepOptions(undefined)).toEqual([]);
});

// The regression this exists for: `options.length` on a provider reads the
// function's parameter count, not its option count - zero for every provider - and
// TypeScript accepts it silently. That reading is what decides whether a letter
// opens the typing box, so it took `D`, `R` and `C` out while leaving `3P` and `2P`
// working (digits open the box regardless). hasStepOptions is the only safe way to ask.
test("a provider counts as having options - .length on it would say zero", () => {
    const provider = () => [{ key: "D", display: "prompt.option.diameter" as const, onSelect: noop }];

    expect(provider.length).toBe(0); // the trap, spelled out
    expect(hasStepOptions(provider)).toBe(true);
});

test("hasStepOptions agrees for arrays, providers and nothing at all", () => {
    expect(hasStepOptions(options)).toBe(true);
    expect(hasStepOptions(() => options)).toBe(true);
    expect(hasStepOptions([])).toBe(false);
    expect(hasStepOptions(() => [])).toBe(false);
    expect(hasStepOptions(undefined)).toBe(false);
});

test("the matched option is the one whose onSelect should run", () => {
    let chosen = "";
    const spied: StepOption[] = [
        { key: "D", display: "prompt.option.diameter", onSelect: () => (chosen = "diameter") },
        { key: "R", display: "prompt.option.radius", onSelect: () => (chosen = "radius") },
    ];

    matchStepOption(spied, "d")?.onSelect();
    expect(chosen).toBe("diameter");
});
