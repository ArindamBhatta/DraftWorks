// Siblings are a flat linked list, so any walk that recurses along `nextSibling` costs a
// stack frame per node. That is invisible on a hand-drawn sketch and fatal on an imported
// one: a DWG or DXF lands every entity in a single folder, so the chain is as long as the
// drawing is large. It surfaced as autosave dying with "Maximum call stack size exceeded"
// after an import, which loses the drawing silently - the save just never happens.
//
// These fix the traversals at a width no recursive implementation survives.

import { expect, test } from "@rstest/core";
import type { IDocument } from "../document";
import { FolderNode } from "./folderNode";
import { type INode, NodeUtils } from "./node";

/** Wide enough to blow the call stack when walked recursively, cheap enough to build. */
const WIDE = 50_000;

/**
 * A minimal stand-in for the linked-list shape the traversals actually read. Real nodes
 * would drag in history and serialization; the walks only ever touch these four fields.
 */
function fakeChain(count: number, parentName = "root") {
    const children: INode[] = [];
    for (let i = 0; i < count; i++) {
        children.push({ name: `${parentName}-${i}` } as INode);
    }
    for (let i = 0; i < count; i++) {
        children[i].previousSibling = children[i - 1];
        children[i].nextSibling = children[i + 1];
    }
    return { firstChild: children[0], add: () => {}, children } as any;
}

test("findNodes walks a folder far wider than the call stack", () => {
    const parent = fakeChain(WIDE);

    const found = NodeUtils.findNodes(parent);

    expect(found.length).toBe(WIDE);
});

test("findNodes keeps document order", () => {
    const parent = fakeChain(8);

    const names = NodeUtils.findNodes(parent).map((node) => node.name);

    expect(names).toEqual(parent.children.map((child: INode) => child.name));
});

test("findNode reaches the last sibling of a very wide folder", () => {
    const parent = fakeChain(WIDE);
    const target = parent.children[WIDE - 1];

    const found = NodeUtils.findNode(parent, (node) => node === target);

    expect(found).toBe(target);
});

test("findNode returns undefined when nothing matches, without overflowing", () => {
    const parent = fakeChain(WIDE);

    expect(NodeUtils.findNode(parent, () => false)).toBeUndefined();
});

test("serializeNode survives a folder holding an imported drawing's worth of entities", () => {
    const document = {} as IDocument;
    const root = new FolderNode({ document, name: "drawing" });
    const children: INode[] = [];
    for (let i = 0; i < WIDE; i++) {
        children.push(new FolderNode({ document, name: `entity-${i}` }));
    }
    // Linked directly rather than through `add`, which would record undo history.
    for (let i = 0; i < WIDE; i++) {
        children[i].parent = root;
        children[i].previousSibling = children[i - 1];
        children[i].nextSibling = children[i + 1];
    }
    (root as any)._firstChild = children[0];

    const serialized = NodeUtils.serializeNode(root);

    // The root plus every child, each child pointing back at the root.
    expect(serialized.length).toBe(WIDE + 1);
    expect((serialized[1] as any)["parentId"]).toBe(root.id);
});

test("serializeNode emits parents before children, which deserialization depends on", () => {
    const document = {} as IDocument;
    const root = new FolderNode({ document, name: "root" });
    const child = new FolderNode({ document, name: "child" });
    const grandchild = new FolderNode({ document, name: "grandchild" });
    const sibling = new FolderNode({ document, name: "sibling" });

    child.parent = root;
    child.nextSibling = sibling;
    sibling.parent = root;
    sibling.previousSibling = child;
    grandchild.parent = child;
    (root as any)._firstChild = child;
    (child as any)._firstChild = grandchild;

    // Asserted through `parentId` because serializeNodeToArray sets it directly, whereas
    // the @serialize() property decorators do not register under the test runner.
    const parentIds = NodeUtils.serializeNode(root).map((entry) => (entry as any)["parentId"]);

    // Pre-order - root, child, the child's subtree, then the sibling. Any breadth-first
    // or sibling-before-child order would put the child's id somewhere else in this list.
    expect(parentIds).toEqual([undefined, root.id, child.id, root.id]);
});
