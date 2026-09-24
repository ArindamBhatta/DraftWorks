// TRIM and EXTEND both come down to "which piece of this curve did the click mean", and
// getting that backwards does not throw - it silently erases the wrong half of a line, or
// stretches the wrong end of it. These pin the answer down without needing OCCT: both
// functions work in curve parameters, so a line running 0..10 with crossings at 3 and 7
// is the whole of the geometry a test needs.

import {
    type IDisposable,
    type IShape,
    type ITrimmedCurve,
    ShapeTypes,
    TrimExtendModes,
    XYZ,
} from "@draftworks/core";
import { expect, test } from "@rstest/core";
import {
    BoundaryFilter,
    boundaryEdgesOf,
    crossingsClearOfEnds,
    extendChange,
    parseTrimExtendMode,
    straightRebuild,
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

// A stand-in for an OCCT shape: all boundaryEdgesOf asks of one is its type and edges.
function fakeShape(shapeType: IShape["shapeType"], edges: IShape[] = []): IShape {
    return { shapeType, findSubShapes: () => edges } as unknown as IShape;
}

test("a rectangle, circle or hatch is a boundary, edge by edge", () => {
    // They are wires and faces, not lone edges. Leaving them out meant a line aimed at a
    // rectangle's wall found nothing to extend to, while one aimed at a plain line did.
    const sides = [1, 2, 3, 4].map(() => fakeShape(ShapeTypes.edge));
    const kept: IDisposable[] = [];
    const keep = (d: IDisposable) => kept.push(d);

    for (const type of [ShapeTypes.wire, ShapeTypes.face, ShapeTypes.compound]) {
        const shape = fakeShape(type, sides);
        expect(new BoundaryFilter().allow(shape)).toBe(true);
        expect(boundaryEdgesOf(shape, keep)).toEqual(sides);
    }
    expect(kept.length).toBe(12);
});

test("a lone edge is its own boundary, and a point is none", () => {
    const line = fakeShape(ShapeTypes.edge);
    expect(boundaryEdgesOf(line, () => {})).toEqual([line]);

    const point = fakeShape(ShapeTypes.vertex);
    expect(new BoundaryFilter().allow(point)).toBe(false);
    expect(boundaryEdgesOf(point, () => {})).toEqual([]);
});

// A vertical line from y=0 to y=494, drawn wall to wall inside a rectangle, with a second
// rectangle around the first at y=-27 and y=521 - the layout EXTEND is most often asked
// to deal with. Points carry the y; the parameter along the line is the same number.
const wallToWall = { start: 0, end: 494 };
const crossingAt = (y: number) => ({ point: { x: 0, y, z: 0 }, parameter: y });
const lineEnds = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 494, z: 0 },
];

test("an end sitting on a wall runs on past it to the next one", () => {
    const candidates = crossingsClearOfEnds([-27, 0, 494, 521].map(crossingAt), lineEnds, 0.013);
    expect(candidates).toEqual([-27, 521]);
    expect(extendChange(wallToWall, 490, candidates)!.affected).toEqual({ start: 494, end: 521 });
});

test("an end a hair short of a wall is still on it", () => {
    // OCCT puts the crossing at 494 and the end at 493.999999. Taken at face value, that
    // is an extension a millionth long - a click that looks like it did nothing.
    const shortEnds = [lineEnds[0], { x: 0, y: 493.999999, z: 0 }];
    const candidates = crossingsClearOfEnds([-27, 0, 494, 521].map(crossingAt), shortEnds, 0.013);
    expect(candidates).toEqual([-27, 521]);
});

test("a wall a visible distance ahead is still a wall", () => {
    const candidates = crossingsClearOfEnds([500, 521].map(crossingAt), lineEnds, 0.013);
    expect(candidates).toEqual([500, 521]);
});

// OFFSET makes a line as an offset curve over the source line cut to length, so the curve
// under the new line ends where the line does and EXTEND had nothing past either end to
// follow. These stand in for the three layers an edge's curve can have.
const along = (x: number) => (t: number) => new XYZ({ x, y: t, z: 0 });
const trimmedOver = (support: object, first: number, last: number, value: (t: number) => XYZ) =>
    ({
        curveType: "trimmedCurve",
        basisCurve: support,
        firstParameter: () => first,
        lastParameter: () => last,
        value,
    }) as unknown as ITrimmedCurve;

test("a line made by OFFSET is rebuilt as a plain line, end to end", () => {
    const offsetLine = { curveType: "offsetCurve", value: along(50), direction: () => XYZ.unitZ };
    const ends = straightRebuild(trimmedOver(offsetLine, 0, 494, along(50)))!;
    expect([ends.start.x, ends.start.y, ends.end.x, ends.end.y]).toEqual([50, 0, 50, 494]);
});

test("a plain line is left as it is", () => {
    const line = { curveType: "line", direction: XYZ.unitY, value: along(0) };
    expect(straightRebuild(trimmedOver(line, 0, 10, along(0)))).toBeUndefined();
});

test("an offset arc is not mistaken for a line", () => {
    const arc = (t: number) => new XYZ({ x: Math.cos(t), y: Math.sin(t), z: 0 });
    const offsetArc = { curveType: "offsetCurve", value: arc, direction: () => XYZ.unitZ };
    expect(straightRebuild(trimmedOver(offsetArc, 0, 1.5, arc))).toBeUndefined();
});
