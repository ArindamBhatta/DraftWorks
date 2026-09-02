// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// An SVG's className is a read-only SVGAnimatedString, so svg() has to apply classes
// through classList instead of letting setProperties assign them like every other
// element. classList.add takes one token at a time and throws on whitespace, so the
// ordinary space-separated form that works everywhere else used to blow up here - at
// runtime only, which no amount of typechecking would have caught.
//
// Read the whitespace test below for what it is: documentation of the contract, not a
// guard. happy-dom quietly splits a whitespace token where a real browser throws
// InvalidCharacterError, so that test passes against the broken implementation too and
// only a browser would have caught the original fault. The "undefined" test is the one
// here that actually fails if the fix is reverted.

import { expect, test } from "@rstest/core";
import { svg } from "./elements";

test("a single class is applied", () => {
    const element = svg({ icon: "icon-eye", className: "toggle" });

    expect(element.classList.contains("toggle")).toBe(true);
});

test("a space-separated className applies every class", () => {
    const element = svg({ icon: "icon-eye", className: "toggle statusCurrent" });

    expect(element.classList.contains("toggle")).toBe(true);
    expect(element.classList.contains("statusCurrent")).toBe(true);
});

test("no className leaves the element unclassed rather than adding 'undefined'", () => {
    const element = svg({ icon: "icon-eye" });

    expect(element.classList.contains("undefined")).toBe(false);
    expect(element.classList.length).toBe(0);
});

test("the icon is referenced by href", () => {
    const element = svg({ icon: "icon-freeze" });
    const use = element.querySelector("use");

    expect(use?.getAttribute("xlink:href")).toBe("#icon-freeze");
});
