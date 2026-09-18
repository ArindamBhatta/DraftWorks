// CHAMFER's Polyline option chamfers every corner of a wire in one pick. The walk
// cannot just run the two-edge corner repeatedly: each corner replaces the two edges
// that made it, so an index taken before the previous corner was applied points at an
// edge that no longer exists. And an edge between two corners is cut at both ends, so
// the second cut has to be made against what the first one left, not against the
// original.
//
// These cover the walk's bookkeeping - which corners are visited, and which version of
// each edge each corner is handed - on a stand-in for the geometry, so a wrong index or
// a dropped trim shows up as a wrong list rather than as a wrong drawing.

import { expect, test } from "@rstest/core";

type Edge = string;

/**
 * EdgeCornerCommand.modifyWholeWire's walk, over labelled edges. A corner turns its two
 * edges into [trimmed-first, chamfer, trimmed-second], which is the same three-piece
 * shape applyToEdgePair returns.
 */
const walk = (edges: Edge[], closed: boolean, refuse: Set<number> = new Set()) => {
    const pieces = new Map<number, Edge[]>();
    const lastCorner = closed ? edges.length - 1 : edges.length - 2;

    for (let i = 0; i <= lastCorner; i++) {
        const next = (i + 1) % edges.length;
        if (refuse.has(i)) continue;

        const first = pieces.get(i)?.at(-1) ?? edges[i];
        const second = pieces.get(next)?.[0] ?? edges[next];
        const parts = [`${first}'`, `ch${i}`, `${second}'`];

        pieces.set(i, [...(pieces.get(i)?.slice(0, -1) ?? []), ...parts.slice(0, -1)]);
        const existing = pieces.get(next);
        const trimmedSecond = parts[parts.length - 1];
        pieces.set(next, existing ? [trimmedSecond, ...existing.slice(1)] : [trimmedSecond]);
    }

    const rebuilt: Edge[] = [];
    for (let i = 0; i < edges.length; i++) {
        rebuilt.push(...(pieces.get(i) ?? [edges[i]]));
    }
    return rebuilt;
};

test("an open wire chamfers its inner corners and leaves its two free ends", () => {
    // Three segments, two corners. Every segment is trimmed where it meets another, and
    // a chamfer appears at each corner.
    const result = walk(["a", "b", "c"], false);

    expect(result).toEqual(["a'", "ch0", "b''", "ch1", "c'"]);
});

test("a middle segment is cut at both ends, the second cut against the first", () => {
    // `b` is trimmed by corner 0 and then again by corner 1. The second trim has to act
    // on the already-trimmed `b'`, giving `b''` - trimming the original twice would
    // silently undo the first cut.
    const result = walk(["a", "b", "c"], false);

    expect(result).toContain("b''");
    expect(result).not.toContain("b'");
});

test("a closed wire also chamfers the corner where it comes back round", () => {
    // The last edge meets the first, which an open wire has no corner for - so a closed
    // triangle gets three chamfers, not two.
    const chamfers = walk(["a", "b", "c"], true).filter((x) => x.startsWith("ch"));

    expect(chamfers).toEqual(["ch0", "ch1", "ch2"]);
});

test("the wrapping corner does not undo the first one", () => {
    // The regression this file caught: the last corner of a closed wire has edge 0 as
    // its second edge, and writing that edge's entry wholesale threw away the chamfer
    // corner 0 had already hung there - leaving a triangle with two chamfers and one
    // corner trimmed at one end only.
    const result = walk(["a", "b", "c"], true);

    expect(result).toEqual(["a''", "ch0", "b''", "ch1", "c''", "ch2"]);
    // Every edge of a closed wire meets a corner at both ends, so every one is cut twice.
    expect(result.filter((x) => x.endsWith("''"))).toHaveLength(3);
});

test("an open wire has one corner fewer than it has segments", () => {
    const chamfers = walk(["a", "b", "c", "d"], false).filter((x) => x.startsWith("ch"));

    expect(chamfers).toEqual(["ch0", "ch1", "ch2"]);
});

test("a corner that cannot be made leaves its edges alone", () => {
    // Parallel segments, or a radius too big for the lines meeting there. AutoCAD skips
    // that corner and does the rest; failing the whole polyline would make the option
    // useless on any real outline.
    const result = walk(["a", "b", "c"], false, new Set([0]));

    expect(result).toContain("a");
    expect(result).toEqual(["a", "b'", "ch1", "c'"]);
});

test("a wire whose corners all refuse comes back unchanged", () => {
    expect(walk(["a", "b", "c"], false, new Set([0, 1]))).toEqual(["a", "b", "c"]);
});
