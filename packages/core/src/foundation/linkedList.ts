/**
 * LinkedListNode represents a single node in the doubly-linked list.
 * Each node maintains bidirectional references (next/prev) which enables
 * efficient traversal and reordering of scene hierarchy nodes in CAD.
 */
interface LinkedListNode<T> {
    data: T;
    next?: LinkedListNode<T>;
    prev?: LinkedListNode<T>;
}

/**
 * LinkedList<T> - High-performance doubly-linked list for CAD scene management
 *
 * CRITICAL for CAD drafting because:
 * 1. O(1) node insertion/removal anywhere in the tree (vs O(n) for arrays)
 *    - Essential when reordering objects in the scene hierarchy
 *    - Supports z-order changes (bringing to front, sending to back)
 *
 * 2. Efficient parent-child relationships in scene graphs
 *    - CAD drawings have hierarchical structures (groups, layers, objects)
 *    - Bidirectional links (prev/next) allow fast sibling navigation
 *
 * 3. Natural support for undo/redo of structural changes
 *    - Reordering nodes doesn't require expensive array shifts
 *    - Minimizes memory allocations during complex operations
 *
 * Example CAD use case:
 *   - User selects a line and presses "Bring to Front"
 *   - LinkedList allows O(1) removal from current position and reinsertion at tail
 *   - Array would require O(n) shift operations on all subsequent elements
 */
export class LinkedList<T> {
    private _head: LinkedListNode<T> | undefined;
    get head() {
        return this._head?.data;
    }

    private _tail: LinkedListNode<T> | undefined;
    get tail() {
        return this._tail?.data;
    }

    private _size: number = 0;
    get size() {
        return this._size;
    }

    /**
     * Add items to the end of the list (O(1) operation).
     * In CAD: Used to append new shapes/objects to the scene hierarchy.
     * Each push operation is constant time regardless of list size.
     */
    push(...items: T[]) {
        for (const item of items) {
            const node: LinkedListNode<T> = { data: item };
            if (!this._head) {
                this._head = this._tail = node;
            } else {
                node.prev = this._tail;
                this._tail!.next = node;
                this._tail = node;
            }
            this._size++;
        }
    }

    /**
     * Insert an item at a specific index (O(1) after finding the node, O(n) for nodeAt lookup).
     *
     * CRITICAL for CAD z-order management:
     *   - Bring to Front: remove from current position, insert at end
     *   - Send to Back: remove from current position, insert at start
     *   - Reorder objects: insert at desired depth position
     *
     * Unlike arrays, insertion doesn't require shifting all subsequent elements.
     * The doubly-linked structure simply updates 4 pointers (O(1) pointer updates vs O(n) array copies).
     */
    insert(index: number, item: T) {
        if (index < 0 || index >= this._size) return;
        if (index === 0) {
            const node: LinkedListNode<T> = { data: item, next: this._head };
            if (this._head) this._head.prev = node;
            this._head = node;
            if (!this._tail) this._tail = node;
            this._size++;
            return;
        }

        const targetNode = this.nodeAt(index);
        if (!targetNode) return;

        const newNode: LinkedListNode<T> = {
            data: item,
            next: targetNode,
            prev: targetNode.prev,
        };

        if (targetNode.prev) targetNode.prev.next = newNode;
        targetNode.prev = newNode;
        this._size++;
    }

    /**
     * Remove a specific item from the list.
     * In CAD: Used to delete objects from the scene (user presses Delete key).
     * O(n) search, but O(1) removal once node is found via removeNode().
     */
    remove(item: T) {
        let current = this._head;
        while (current) {
            if (current.data === item) {
                this.removeNode(current);
                return;
            }
            current = current.next;
        }
    }

    /**
     * Remove an item at a specific index.
     * In CAD: Used to remove objects at a known depth position.
     */
    removeAt(index: number) {
        const node = this.nodeAt(index);
        if (node) this.removeNode(node);
    }

    /**
     * Internal method to remove a node by updating pointers.
     * O(1) operation - only updates 4 pointers regardless of list size.
     *
     * This is the true power of linked lists for CAD:
     *   - Array removal requires shifting all elements after the removed item
     *   - LinkedList removal just reroutes two links (previous.next and next.prev)
     *   - Massive performance difference for deep hierarchies with frequent deletions
     */
    private removeNode(node: LinkedListNode<T>) {
        if (node.prev) {
            node.prev.next = node.next;
        } else {
            this._head = node.next;
        }
        if (node.next) {
            node.next.prev = node.prev;
        } else {
            this._tail = node.prev;
        }
        this._size--;
    }

    private nodeAt(index: number): LinkedListNode<T> | undefined {
        if (index < 0 || index >= this._size) return undefined;
        if (index === 0) return this._head;
        if (index === this._size - 1) return this._tail;

        let current: LinkedListNode<T> | undefined;
        if (index <= this._size / 2) {
            current = this._head;
            for (let i = 0; i < index; i++) {
                current = current!.next;
            }
        } else {
            current = this._tail;
            for (let i = this._size - 1; i > index; i--) {
                current = current!.prev;
            }
        }
        return current;
    }

    clear() {
        this._head = undefined;
        this._tail = undefined;
        this._size = 0;
    }

    /**
     * Reverse the entire list in-place (O(n) time, O(1) space).
     * In CAD: Used to reverse rendering order or layer stacking without array reconstruction.
     * The doubly-linked structure makes this an elegant swap of next/prev pointers.
     */
    reverse() {
        let currentNode = this._head;
        while (currentNode) {
            const next = currentNode.next;
            currentNode.next = currentNode.prev;
            currentNode.prev = next;
            currentNode = currentNode.prev;
        }
        const tail = this._tail;
        this._tail = this._head;
        this._head = tail;
    }

    *[Symbol.iterator](): IterableIterator<T> {
        let current = this._head;
        while (current) {
            yield current.data;
            current = current.next;
        }
    }
}
