// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// The function-key row's whole value is that it matches AutoCAD's, so the bindings are
// pinned here rather than left to whoever edits the table next. F10 and F11 in particular
// look arbitrary and are not: AutoCAD puts polar tracking on F10 and object snap tracking
// on F11, and a drafter arriving with that in their fingers is the reason the row exists.

import { expect, test } from "@rstest/core";
import { Config } from "../config";
import { FunctionKeyToggles, functionKeyFor } from "./functionKeys";

test("the row is bound the way AutoCAD binds it", () => {
    const bound = Object.fromEntries(FunctionKeyToggles.map((t) => [t.key, t.property]));
    expect(bound).toEqual({
        F3: "enableSnap",
        F7: "enableGrid",
        F8: "enableOrtho",
        F10: "enablePolarTracking",
        F11: "enableSnapTracking",
        F12: "enableDynamicInput",
    });
});

test("no key is claimed twice", () => {
    const keys = FunctionKeyToggles.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
});

test("F1 and F2 are left to the panels they open", () => {
    // They toggle UI rather than a Config flag, so FunctionKeyService handles them
    // directly - a binding here would mean two handlers for one press.
    expect(functionKeyFor("enableOrtho")).toBe("F8");
    expect(FunctionKeyToggles.some((t) => t.key === "F1" || t.key === "F2")).toBe(false);
});

test("every bound property is a real boolean setting on Config", () => {
    // The table drives `Config.instance[property] = !Config.instance[property]`, so a
    // property that is not there toggles nothing and reports success anyway.
    for (const toggle of FunctionKeyToggles) {
        expect(typeof Config.instance[toggle.property]).toBe("boolean");
    }
});
