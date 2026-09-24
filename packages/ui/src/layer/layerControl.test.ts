// The ribbon's layer combo used to read the current layer and nothing else, so selecting
// an object on DOOR while layer 0 was current still showed 0 - the control disagreed
// with what was highlighted on screen. These pin AutoCAD's actual rule, including the
// case that has no obvious answer: a selection spanning layers shows nothing at all.

import type { IDocument, INode } from "@draftworks/core";
import { FolderNode, TextAnnotation, XYZ } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { selectedLayerId } from "./layerControl";

const document = {
    modelManager: { currentLayerId: "0" },
    history: { disabled: true },
} as unknown as IDocument;

/** Only a VisualNode carries a layer; TextAnnotation is a cheap concrete one. */
function nodeOn(layerId: string): INode {
    const node = new TextAnnotation({
        document,
        annotationType: "text",
        name: layerId,
        content: "x",
        position: XYZ.zero,
    });
    node.layerId = layerId;
    return node as unknown as INode;
}

test("a single selected object reports its own layer", () => {
    expect(selectedLayerId([nodeOn("door")])).toBe("door");
});

test("several objects sharing a layer report that layer", () => {
    expect(selectedLayerId([nodeOn("wall"), nodeOn("wall"), nodeOn("wall")])).toBe("wall");
});

test("objects on different layers report nothing, so the control goes blank", () => {
    expect(selectedLayerId([nodeOn("wall"), nodeOn("door")])).toBeUndefined();
});

test("a single mismatch anywhere in a long selection still blanks the control", () => {
    const nodes = [nodeOn("wall"), nodeOn("wall"), nodeOn("wall"), nodeOn("window")];

    expect(selectedLayerId(nodes)).toBeUndefined();
});

test("an empty selection reports nothing, leaving the caller on the current layer", () => {
    expect(selectedLayerId([])).toBeUndefined();
});

test("a node with no layer of its own is skipped rather than counted as a second layer", () => {
    // A folder is not a VisualNode, so selecting one alongside objects on a single
    // layer must not blank the control.
    const folder = new FolderNode({ document, name: "group" }) as unknown as INode;

    expect(selectedLayerId([nodeOn("wall"), folder, nodeOn("wall")])).toBe("wall");
});
