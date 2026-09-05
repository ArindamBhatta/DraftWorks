import type { IDocument } from "../document";
import { HistoryObservable, type IDisposable, Id, type IPropertyChanged } from "../foundation";
import { property } from "../property";
import { type Serialized, Serializer, serialize } from "../serialize";

// INode is the identity every entry in the document tree shares (folders, bodies,
// imported meshes...). It is split from INodeLinkedList below so that only the
// container-shaped nodes (folders, groups) carry add/remove/child-traversal behavior
// while leaf nodes (a single BoxNode, a single line) stay simple - the tree is a
// Composite of two node "shapes" sharing one identity contract, not one god-interface.
export interface INode extends IPropertyChanged, IDisposable {
    readonly id: string;
    visible: boolean;
    parentVisible: boolean;
    name: string;
    parent: INodeLinkedList | undefined;
    previousSibling: INode | undefined;
    nextSibling: INode | undefined;
    clone(): this;
}

// Containers (folders/groups) additionally expose child access and mutation.
// Only INodeLinkedList instances can hold children - see NodeUtils.isLinkedListNode,
// which is how the rest of the codebase tells "leaf" and "container" nodes apart
// at runtime without a parallel type-tag.
export interface INodeLinkedList extends INode {
    get firstChild(): INode | undefined;
    get lastChild(): INode | undefined;
    add(...items: INode[]): void;
    remove(...items: INode[]): void;
    transfer(...items: INode[]): void;
    size(): number;
    insertAfter(target: INode | undefined, node: INode): void;
    insertBefore(target: INode | undefined, node: INode): void;
    move(child: INode, newParent: this, newPreviousSibling?: INode): void;
}

// Node is the base of every document-tree entry. It extends HistoryObservable
// (not just Observable) so that every property write on every node - a rename, a
// visibility toggle, a parametric-body property change - is automatically undo/redo
// eligible without each subclass having to wire that up itself.
//
// parent/previousSibling/nextSibling are plain fields forming a doubly-linked list,
// not indices into a parent's children array. That makes moving/reordering a node
// (drag in the project tree, undo of a delete) an O(1) pointer relink instead of an
// array splice, and it's why traversal helpers below (NodeUtils) walk sibling chains
// recursively rather than iterating an array.
export abstract class Node extends HistoryObservable implements INode {
    parent: INodeLinkedList | undefined;
    previousSibling: INode | undefined;
    nextSibling: INode | undefined;

    @serialize()
    readonly id: string;

    constructor(document: IDocument, name: string, id: string) {
        super(document);
        this.id = id;
        this.setPrivateValue("name", name || "untitled");
    }

    @serialize()
    @property("common.name")
    get name() {
        return this.getPrivateValue("name");
    }
    set name(value: string) {
        this.setProperty("name", value);
    }

    @serialize()
    get visible(): boolean {
        return this.getPrivateValue("visible", true);
    }
    set visible(value: boolean) {
        this.setProperty("visible", value, () => this.onVisibleChanged());
    }

    protected abstract onVisibleChanged(): void;

    get parentVisible() {
        return this.getPrivateValue("parentVisible", true);
    }
    set parentVisible(value: boolean) {
        this.setProperty("parentVisible", value, () => this.onParentVisibleChanged());
    }

    override disposeInternal(): void {
        this.document.visual.context.removeNode([this]);
        super.disposeInternal();
    }

    // Cloning goes through the serialize/deserialize round-trip rather than a
    // hand-written field copy so it automatically stays correct as subclasses add
    // @serialize()'d properties - a new body property is clone-safe for free. History
    // is disabled for the duration so the clone itself doesn't get recorded as an
    // undoable "field set" per property.
    clone(): this {
        const oldValue = this.document.history.disabled;
        try {
            this.document.history.disabled = true;
            const serialized = Serializer.serializeObject(this);
            serialized["id"] = Id.generate();
            serialized["name"] = `${this.name}_copy`;
            return Serializer.deserializeObject(this.document, serialized) as this;
        } finally {
            this.document.history.disabled = oldValue;
        }
    }

    protected abstract onParentVisibleChanged(): void;
}

export class NodeUtils {
    public static isLinkedListNode(node: INode): node is INodeLinkedList {
        return (node as INodeLinkedList).add !== undefined;
    }

    static getNodesBetween(node1: INode, node2: INode): INode[] {
        if (node1 === node2) return [node1];
        const nodes: INode[] = [];
        const prePath = NodeUtils.getPathToRoot(node1);
        const curPath = NodeUtils.getPathToRoot(node2);
        const index = NodeUtils.getCommonParentIndex(prePath, curPath);
        const parent = prePath.at(1 - index) as INodeLinkedList;
        if (parent === curPath[0] || parent === prePath[0]) {
            const child = parent === curPath[0] ? prePath[0] : curPath[0];
            NodeUtils.getNodesFromParentToChild(nodes, parent, child);
        } else if (NodeUtils.currentAtBack(prePath.at(-index)!, curPath.at(-index)!)) {
            NodeUtils.getNodesFromPath(nodes, prePath, curPath, index);
        } else {
            NodeUtils.getNodesFromPath(nodes, curPath, prePath, index);
        }
        return nodes;
    }

    static getNodesFromPath(nodes: INode[], path1: INode[], path2: INode[], commonIndex: number) {
        NodeUtils.nodeOrChildrenAppendToNodes(nodes, path1[0]);
        NodeUtils.path1ToCommonNodes(nodes, path1, commonIndex);
        NodeUtils.commonToPath2Nodes(nodes, path1, path2, commonIndex);
    }

    static path1ToCommonNodes(nodes: INode[], path1: INode[], commonIndex: number) {
        for (let i = 0; i < path1.length - commonIndex; i++) {
            let next = path1[i].nextSibling;
            while (next !== undefined) {
                NodeUtils.nodeOrChildrenAppendToNodes(nodes, next);
                next = next.nextSibling;
            }
        }
    }

    static commonToPath2Nodes(nodes: INode[], path1: INode[], path2: INode[], commonIndex: number) {
        let nextParent = path1.at(-commonIndex)?.nextSibling;
        while (nextParent) {
            if (nextParent === path2[0]) {
                nodes.push(path2[0]);
                return;
            }
            if (NodeUtils.isLinkedListNode(nextParent)) {
                if (NodeUtils.getNodesFromParentToChild(nodes, nextParent, path2[0])) {
                    return;
                }
            } else {
                nodes.push(nextParent);
            }
            nextParent = nextParent.nextSibling;
        }
    }

    public static nodeOrChildrenAppendToNodes(nodes: INode[], node: INode) {
        if (NodeUtils.isLinkedListNode(node)) {
            NodeUtils.getNodesFromParentToChild(nodes, node);
        } else {
            nodes.push(node);
        }
    }

    public static findTopLevelNodes(nodes: Set<INode>) {
        const result: INode[] = [];
        for (const node of nodes) {
            if (!NodeUtils.containsDescendant(nodes, node)) {
                result.push(node);
            }
        }
        return result;
    }

    static containsDescendant(nodes: Set<INode>, node: INode): boolean {
        if (node.parent === undefined) return false;
        if (nodes.has(node.parent)) return true;
        return NodeUtils.containsDescendant(nodes, node.parent);
    }

    private static getNodesFromParentToChild(
        nodes: INode[],
        parent: INodeLinkedList,
        until?: INode,
    ): boolean {
        nodes.push(parent);
        let node = parent.firstChild;
        while (node !== undefined) {
            if (until === node) {
                nodes.push(node);
                return true;
            }

            if (NodeUtils.isLinkedListNode(node)) {
                if (NodeUtils.getNodesFromParentToChild(nodes, node, until)) return true;
            } else {
                nodes.push(node);
            }
            node = node.nextSibling;
        }
        return false;
    }

    private static currentAtBack(preNode: INode, curNode: INode) {
        while (preNode.nextSibling !== undefined) {
            if (preNode.nextSibling === curNode) return true;
            preNode = preNode.nextSibling;
        }
        return false;
    }

    private static getCommonParentIndex(prePath: INode[], curPath: INode[]) {
        let index = 1;
        for (index; index <= Math.min(prePath.length, curPath.length); index++) {
            if (prePath.at(-index) !== curPath.at(-index)) break;
        }
        if (prePath.at(1 - index) !== curPath.at(1 - index)) throw new Error("can not find a common parent");
        return index;
    }

    private static getPathToRoot(node: INode): INode[] {
        const path: INode[] = [];
        let parent: INode | undefined = node;
        while (parent !== undefined) {
            path.push(parent);
            parent = parent.parent;
        }
        return path;
    }

    static findNode(parent: INodeLinkedList, predicate: (value: INode) => boolean) {
        // Iterative for the same reason as findNodes: a recursive walk spends a stack
        // frame per sibling, and an imported drawing is one folder of many entities.
        // Visit order is unchanged, so the first match found is the same node as before.
        const stack: INode[] = [];
        if (parent.firstChild) stack.push(parent.firstChild);

        while (stack.length > 0) {
            const node = stack.pop()!;

            if (predicate(node)) return node;

            if (node.nextSibling) stack.push(node.nextSibling);
            if (NodeUtils.isLinkedListNode(node) && node.firstChild) stack.push(node.firstChild);
        }
        return undefined;
    }

    static findNodes(parent: INodeLinkedList, predicate?: (value: INode) => boolean) {
        // Iterative for the same reason as serializeNodeToArray: sibling chains are as
        // long as a folder has children, and a recursive walk overflows on an imported
        // drawing. Pre-order is preserved, so the result order is unchanged.
        const result: INode[] = [];
        const stack: INode[] = [];
        if (parent.firstChild) stack.push(parent.firstChild);

        while (stack.length > 0) {
            const node = stack.pop()!;

            if (!predicate || predicate(node)) {
                result.push(node);
            }

            if (node.nextSibling) stack.push(node.nextSibling);
            if (NodeUtils.isLinkedListNode(node) && node.firstChild) stack.push(node.firstChild);
        }
        return result;
    }

    static serializeNode(node: INode) {
        const nodes: Serialized[] = [];
        NodeUtils.serializeNodeToArray(nodes, node, undefined);
        return nodes;
    }

    private static serializeNodeToArray(nodes: Serialized[], node: INode, parentId: string | undefined) {
        // Iterative rather than recursive because siblings form a flat linked list of
        // unbounded length: an imported drawing puts every entity in one folder, so
        // recursing along `nextSibling` cost one stack frame per entity and overflowed on
        // any real drawing. Descending into `firstChild` is the only axis kept on the
        // stack, and that is bounded by nesting depth.
        //
        // Pre-order is preserved exactly - a node, then its subtree, then its next sibling
        // - because `deserializeNode` requires every parent to appear before its children.
        // Pushing the sibling before the child makes the child pop first.
        const stack: { node: INode; parentId: string | undefined }[] = [{ node, parentId }];

        while (stack.length > 0) {
            const current = stack.pop()!;
            const serialized: any = Serializer.serializeObject(current.node);
            if (current.parentId) serialized["parentId"] = current.parentId;
            nodes.push(serialized);

            if (current.node.nextSibling) {
                stack.push({ node: current.node.nextSibling, parentId: current.parentId });
            }
            if (NodeUtils.isLinkedListNode(current.node) && current.node.firstChild) {
                stack.push({ node: current.node.firstChild, parentId: current.node.id });
            }
        }
        return nodes;
    }

    public static async deserializeNode(document: IDocument, nodes: Serialized[]) {
        const nodeMap: Map<string, INodeLinkedList> = new Map();
        nodes.forEach((n) => {
            const node = Serializer.deserializeObject(document, n);
            if (NodeUtils.isLinkedListNode(node)) {
                nodeMap.set(n["id"], node);
            }
            const parentId = (n as any)["parentId"];
            if (!parentId) return;
            if (nodeMap.has(parentId)) {
                nodeMap.get(parentId)!.add(node);
            } else {
                console.warn(`parent not found: ${parentId}`);
            }
        });
        return Promise.resolve(nodeMap.get(nodes[0]["id"]));
    }
}
