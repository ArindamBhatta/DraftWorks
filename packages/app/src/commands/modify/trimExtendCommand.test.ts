// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// TRIM and EXTEND both come down to "which piece of this curve did the click mean", and
// getting that backwards does not throw - it silently erases the wrong half of a line, or
// stretches the wrong end of it. These pin the answer down without needing OCCT: both
// functions work in curve parameters, so a line running 0..10 with crossings at 3 and 7
// is the whole of the geometry a test needs.

import { TrimExtendModes } from "@chili3d/core";
import { expect, test } from "@rstest/core";
import {
    extendChange,
    parseTrimExtendMode,
    TrimExtendModeLabels,
    trimChange,
    trimExtendModeOf,
} from "./trimExtendCommand";

// A line from 0 to 10 crossed at 3 and 7, as trimChange wants it: crossings and the
// edge's own two ends, sorted.
const crossedTwice = [0, 3, 7, 10];

test("a click between two crossings takes out the piece between them", () => {
    const change = trimChange(crossedTwice, 5);
    expect(change.affected).toEqual({ start: 3, end: 7 });
    expect(change.result).toEqual([
        { start: 0, end: 3 },
        { start: 7, end: 10 },
    ]);
});

test("a click before the first crossing takes out the stub, not the body", () => {
    const change = trimChange(crossedTwice, 1);
    expect(change.affected).toEqual({ start: 0, end: 3 });
    // One piece, not two: the stub had nothing on its far side to leave behind.
    expect(change.result).toEqual([{ start: 3, end: 10 }]);
});

test("a click after the last crossing takes out the far stub", () => {
    const change = trimChange(crossedTwice, 9);
    expect(change.affected).toEqual({ start: 7, end: 10 });
    expect(change.result).toEqual([{ start: 0, end: 7 }]);
});

test("an edge nothing crosses is erased whole", () => {
    // Only its own ends are in the list, so the one piece a click can name is all of it -
    // which is what TRIM does to an unbounded object in AutoCAD.
    const change = trimChange([0, 10], 5);
    expect(change.affected).toEqual({ start: 0, end: 10 });
    expect(change.result).toEqual([]);
});

const span = { start: 0, end: 10 };

test("a click near the far end runs that end on to the next boundary", () => {
    const change = extendChange(span, 9, [14, 20])!;
    expect(change.result).toEqual([{ start: 0, end: 14 }]);
    // Only the new stretch is previewed: the edge that was already there does not move.
    expect(change.affected).toEqual({ start: 10, end: 14 });
});

test("a click near the near end runs the other way", () => {
    const change = extendChange(span, 1, [-6, -2])!;
    expect(change.result).toEqual([{ start: -2, end: 10 }]);
    expect(change.affected).toEqual({ start: -2, end: 0 });
});

test("boundaries the edge already crosses cannot shorten it", () => {
    // 4 lies inside the edge. Reaching it would be a trim, and EXTEND does not trim.
    expect(extendChange(span, 9, [4])).toBeUndefined();
    expect(extendChange(span, 1, [4])).toBeUndefined();
});

test("an end with nothing in front of it stays where it is", () => {
    // Something to reach going forwards, nothing going back.
    expect(extendChange(span, 1, [14])).toBeUndefined();
});

const arc = { start: 0, end: Math.PI };
const circle = Math.PI * 2;

test("an arc reaches round the way it is not yet drawn", () => {
    // 1.0 is on the arc already and 4.0 is in the gap, so only 4.0 is reachable.
    const change = extendChange(arc, 3, [1, 4], circle)!;
    expect(change.result[0].start).toBeCloseTo(0);
    expect(change.result[0].end).toBeCloseTo(4);
});

test("extending an arc backwards crosses zero rather than going the long way", () => {
    const change = extendChange(arc, 0.2, [4], circle)!;
    // 4.0 measured backwards from the arc's start, which is 4 - 2pi.
    expect(change.result[0].start).toBeCloseTo(4 - circle);
    expect(change.result[0].end).toBeCloseTo(Math.PI);
});

test("a closed circle has no end left to extend", () => {
    expect(extendChange({ start: 0, end: circle }, 1, [2], circle)).toBeUndefined();
});

test("every mode the setting can hold has a label, and every label maps back", () => {
    // The dropdown and the status bar's [O] both write labels; TRIMEXTENDMODE stores
    // modes. A mode with no label would drop off the dropdown, and a label that no
    // longer maps back would make the setter a silent no-op - a dropdown that will not
    // move, with nothing anywhere to say why.
    for (const mode of TrimExtendModes) {
        const label = TrimExtendModeLabels[mode];
        expect(label).toBeDefined();
        expect(trimExtendModeOf(label)).toBe(mode);
    }
});

test("a label from some other command names no mode at all", () => {
    expect(trimExtendModeOf("option.command.placementMode.single")).toBeUndefined();
});

test("the mode answer is read however it is capitalised or abbreviated", () => {
    for (const text of ["q", "Q", "quick", " Quick "]) {
        expect(parseTrimExtendMode(text, TrimExtendModeLabels.standard)).toBe(TrimExtendModeLabels.quick);
    }
    for (const text of ["s", "S", "standard", " Standard "]) {
        expect(parseTrimExtendMode(text, TrimExtendModeLabels.quick)).toBe(TrimExtendModeLabels.standard);
    }
});

test("an empty answer takes the mode the prompt is already showing", () => {
    // AutoCAD's <...>: Enter alone at "[Quick/Standard] <Standard>" means Standard, and
    // it is the only way the answer can come back unchanged.
    expect(parseTrimExtendMode("", TrimExtendModeLabels.standard)).toBe(TrimExtendModeLabels.standard);
    expect(parseTrimExtendMode("  ", TrimExtendModeLabels.quick)).toBe(TrimExtendModeLabels.quick);
});

test("an answer that is neither mode is rejected rather than guessed at", () => {
    // Undefined re-asks the question. Falling back to a default here would lock the run
    // into a mode the user did not type, which is the one thing the lock must not do.
    for (const text of ["x", "qq", "stand", "1"]) {
        expect(parseTrimExtendMode(text, TrimExtendModeLabels.quick)).toBeUndefined();
    }
});
