// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Units and dimension style are chosen once and then expected to stay chosen. Before
// these settings persisted, every reload reset them to the defaults and the start-up
// flow asked for them all over again - which is what "why do I need to set it again
// from scratch" looked like from the outside.

import { expect, test } from "@rstest/core";
import { ObjectStorage } from "../objectStorage";
import { DimensionSetup } from "./drawingSetup";
import { UnitSetup } from "./unitSetup";

function clearStorage() {
    ObjectStorage.default.remove("unitSetup");
    ObjectStorage.default.remove("dimensionSetup");
}

test("confirming units writes them where the next session will look", () => {
    clearStorage();

    UnitSetup.configure({ type: "decimal", precision: 3, baseUnit: "mm" });

    expect(ObjectStorage.default.value("unitSetup")).toEqual({
        type: "decimal",
        precision: 3,
        baseUnit: "mm",
    });
});

test("units come back from the last session", () => {
    clearStorage();
    UnitSetup.configure({ type: "fractional", precision: 8, baseUnit: "cm" });
    // Simulate a reload by resetting to something else, then restoring.
    UnitSetup.configure({ type: "architectural", precision: 16, baseUnit: "in" });

    ObjectStorage.default.setValue("unitSetup", { type: "fractional", precision: 8, baseUnit: "cm" });
    expect(UnitSetup.restore()).toBe(true);

    expect(UnitSetup.settings).toEqual({ type: "fractional", precision: 8, baseUnit: "cm" });
    expect(UnitSetup.isRestored).toBe(true);
});

test("a first run has nothing to restore and keeps the defaults", () => {
    clearStorage();

    expect(UnitSetup.restore()).toBe(false);
});

test("dimension style survives the same round trip", () => {
    clearStorage();

    DimensionSetup.configure({ textHeight: 4, arrowSize: 3, extensionOffset: 1, precision: 2 });
    DimensionSetup.configure({ textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.625, precision: 16 });

    ObjectStorage.default.setValue("dimensionSetup", {
        textHeight: 4,
        arrowSize: 3,
        extensionOffset: 1,
        precision: 2,
    });
    expect(DimensionSetup.restore()).toBe(true);
    expect(DimensionSetup.settings).toEqual({
        textHeight: 4,
        arrowSize: 3,
        extensionOffset: 1,
        precision: 2,
    });
});

test("junk in storage is ignored rather than fatal", () => {
    clearStorage();
    ObjectStorage.default.setValue("unitSetup", { nonsense: true });

    expect(UnitSetup.restore()).toBe(false);
});
