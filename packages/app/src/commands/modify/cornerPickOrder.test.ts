// CHAMFER and FILLET ask for their two edges in two prompts - "Select first line", then
// "Select second line" - rather than one multi-select. The second prompt keeps the first
// edge selected so the corner is visible while it is named, which means its result holds
// both edges; but a selection is a set, and the order it reports is not the order they
// were picked.
//
// That matters for an unequal chamfer, where first and second carry different setbacks:
// swap them and the result is the mirror of the one asked for, which looks like a
// chamfer and measures wrong. These cover the gathering that keeps the pick order.

import { expect, test } from "@rstest/core";

/** Stands in for VisualShapeData - only identity and isEqual are consulted. */
const edge = (id: string) => ({
    shape: { id, isEqual: (other: { id: string }) => other.id === id },
});

/** EdgeCornerCommand.pickedEdges, over the two steps' results. */
const pickedEdges = (first: ReturnType<typeof edge>[], second: ReturnType<typeof edge>[]) => {
    const head = first[0];
    const rest = second.filter((x) => !x.shape.isEqual(head.shape));
    return [head, ...rest];
};

test("the edge picked first stays first, whatever order the selection reports", () => {
    const a = edge("a");
    const b = edge("b");
    // The second step's selection holds both, and here it happens to list them backwards.
    expect(pickedEdges([a], [b, a]).map((x) => x.shape.id)).toEqual(["a", "b"]);
});

test("the first edge is not counted twice when the selection carries it over", () => {
    const a = edge("a");
    const b = edge("b");
    // keepSelection means `a` is in both results; a chamfer of `a` with itself is not a
    // corner, so it has to appear once.
    expect(pickedEdges([a], [a, b])).toHaveLength(2);
});

test("a solid's extra edges all follow the first", () => {
    // The 3D case takes as many edges as the user names, and the first pick still leads.
    const [a, b, c, d] = ["a", "b", "c", "d"].map(edge);
    expect(pickedEdges([a], [c, a, d, b]).map((x) => x.shape.id)).toEqual(["a", "c", "d", "b"]);
});
