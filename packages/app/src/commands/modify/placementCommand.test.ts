// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// MOVE and COPY read the same picks three different ways, and getting one of them
// backwards does not throw - it quietly puts the drawing somewhere else. These pin
// down which reading applies when, and how a Multiple run rebases between rounds.

import { XYZ } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { PlacementModes, parsePlacementMode, placementShift } from "./placementCommand";

const at = (x: number, y: number) => new XYZ({ x, y, z: 0 });

test("two picks shift by the distance between them, not by where they are", () => {
    const shift = placementShift(at(100, 100), at(110, 105));
    expect(shift.x).toBeCloseTo(10);
    expect(shift.y).toBeCloseTo(5);
});

test("Displacement reads the single point as the shift itself", () => {
    // `10,0` in Displacement mode moves ten along x wherever the objects sit - it is
    // not "move to x=10", which is what subtracting a base point would have meant.
    const shift = placementShift(undefined, at(10, 0));
    expect(shift.x).toBeCloseTo(10);
    expect(shift.y).toBeCloseTo(0);
});

test("Enter at the second-point prompt reads the base point as the shift", () => {
    // AutoCAD's <use first point as displacement>: the second point is never picked,
    // so whatever stands in for it must be ignored.
    const shift = placementShift(at(10, 0), at(10, 0), true);
    expect(shift.x).toBeCloseTo(10);
    expect(shift.y).toBeCloseTo(0);
});

test("a Multiple move rebases so the second round does not repeat the first", () => {
    // Round one moves the objects from the base to the pick, so the base travels with
    // them; round two is then measured from where they landed. Rebasing to base+shift
    // is what stops the second pick re-applying the first move on top of itself.
    const base = at(0, 0);
    const first = at(10, 0);
    const landed = base.add(placementShift(base, first));
    expect(landed.x).toBeCloseTo(10);

    const second = placementShift(landed, at(25, 0));
    expect(second.x).toBeCloseTo(15);
});

test("a Multiple copy keeps its base, so every copy is offset from the same point", () => {
    // The originals never move, so the base does not either: two picks 10 and 25 along
    // x drop copies at 10 and 25, not at 10 and 35.
    const base = at(0, 0);
    expect(placementShift(base, at(10, 0)).x).toBeCloseTo(10);
    expect(placementShift(base, at(25, 0)).x).toBeCloseTo(25);
});

test("the mode answer is read however it is capitalised or abbreviated", () => {
    for (const text of ["s", "S", "single", " Single "]) {
        expect(parsePlacementMode(text, PlacementModes.multiple)).toBe(PlacementModes.single);
    }
    for (const text of ["m", "M", "multiple", "Multiple"]) {
        expect(parsePlacementMode(text, PlacementModes.single)).toBe(PlacementModes.multiple);
    }
});

test("an empty answer keeps the mode shown in the prompt's <...>", () => {
    expect(parsePlacementMode("", PlacementModes.multiple)).toBe(PlacementModes.multiple);
    expect(parsePlacementMode("   ", PlacementModes.single)).toBe(PlacementModes.single);
});

test("anything else is rejected rather than silently taken as a mode", () => {
    for (const text of ["x", "1", "sing", "mult"]) {
        expect(parsePlacementMode(text, PlacementModes.single)).toBeUndefined();
    }
});
