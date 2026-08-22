import type { IDisposable } from "./disposable";
import { Observable } from "./observer";

/**
 * CollectionAction describes what type of change occurred in a collection.
 * Used to notify subscribers about structural changes to CAD scene data.
 */
export type CollectionAction = "add" | "remove" | "move" | "replace";

/**
 * CollectionChangedArgs provides detailed information about collection mutations.
 *
 * CAD use cases:
 *   - "add": New shapes created or imported into the scene
 *   - "remove": Objects deleted or removed from a group/layer
 *   - "move": Objects reordered (z-order changes, layer reorganization)
 *   - "replace": Objects substituted (pattern fill updates, symbol replacements)
 *
 * The structured args allow UI and internal systems to react precisely to changes
 * without needing to scan the entire collection for diffs.
 */
export type CollectionChangedArgs =
    | {
          action: "add";
          items: any[];
      }
    | {
          action: "remove";
          items: any[];
      }
    | {
          action: "move";
          from: number;
          to: number;
      }
    | {
          action: "replace";
          index: number;
          item: any;
          items: any[];
      };

/**
 * ICollectionChanged - Event interface for observing collection mutations.
 * Enables reactive updates when the scene hierarchy or selection set changes.
 */
export interface ICollectionChanged {
    onCollectionChanged(callback: (args: CollectionChangedArgs) => void): void;
    removeCollectionChanged(callback: (args: CollectionChangedArgs) => void): void;
}

/**
 * ObservableCollection<T> - Reactive collection that notifies subscribers of all mutations.
 *
 * ESSENTIAL for CAD because it enables:
 *
 * 1. Real-time UI synchronization
 *    - When user adds/deletes/reorders objects, the UI updates automatically
 *    - No manual polling or manual state management needed
 *    - Example: Properties panel reflects selection changes instantly
 *
 * 2. Undo/Redo system integration
 *    - Each mutation (add/remove/move/replace) triggers a notification
 *    - Undo manager can record these events and replay them backward
 *    - Provides fine-grained history for complex operations
 *
 * 3. Multi-view consistency
 *    - Viewport, layers panel, and properties all stay in sync
 *    - No duplicate state; single source of truth
 *    - Observer pattern prevents circular dependency hell
 *
 * 4. Selection set management
 *    - Maintains the set of currently selected objects
 *    - Notifies when selection changes (critical for tools that depend on selection)
 *    - Enables "select all", "invert selection", "select by type" operations
 *
 * 5. Batch operations with efficiency
 *    - Can group multiple changes and notify once (transaction pattern)
 *    - Prevents redundant UI repaints during complex operations
 *
 * Example CAD workflow:
 *   - User imports a DWG file with 1000 objects
 *   - Each object triggers onCollectionChanged callback
 *   - UI updates layers panel progressively
 *   - Undo manager records the "import 1000 objects" action
 */
export class ObservableCollection<T> extends Observable implements ICollectionChanged, IDisposable {
    private readonly _callbacks = new Set<(args: CollectionChangedArgs) => void>();
    private _items: T[];

    constructor(...items: T[]) {
        super();
        this._items = Array.from(items);
    }

    /**
     * Add items to the collection and notify all observers.
     * In CAD: Triggered when user creates new shapes, imports objects, or groups items.
     * Subscribers can use this to update the layers panel, update bounding boxes, etc.
     */
    push(...items: T[]) {
        if (items.length === 0) return;
        this._items.push(...items);
        this.notifyChange({
            action: "add",
            items,
        });
    }

    /**
     * Remove items from the collection and notify all observers.
     * In CAD: Triggered when user deletes objects (Delete key) or ungroups.
     * The notifyChange() call ensures UI updates immediately without polling.
     * Undo manager receives this event to enable redo.
     */
    remove(...items: T[]) {
        if (items.length === 0) return;
        const itemSet = new Set(items);
        this._items = this._items.filter((item) => !itemSet.has(item));
        this.notifyChange({
            action: "remove",
            items,
        });
    }

    /**
     * Reorder an item by moving it from one position to another.
     * In CAD: Used for z-order operations (Bring to Front, Send to Back, Arrange).
     *         Also used for reordering layers or groups in the hierarchy.
     * Notifies observers so rendering order updates immediately.
     */
    move(from: number, to: number) {
        if (!this.isValidMove(from, to)) return;

        const items = this._items.splice(from, 1);
        this._items.splice(from < to ? to - 1 : to, 0, ...items);
        this.notifyChange({
            action: "move",
            from,
            to,
        });
    }

    private isValidMove(from: number, to: number): boolean {
        return from !== to && from >= 0 && from < this._items.length && to >= 0 && to < this._items.length;
    }

    /**
     * Remove all items from the collection and notify observers.
     * In CAD: Used when clearing the selection, or clearing all objects from the scene.
     * Notifies with a single "remove" event containing all removed items.
     * This allows undo manager to record "clear scene" as one atomic operation.
     */
    clear() {
        if (this._items.length === 0) return;
        const items = this.items();
        this._items = [];
        this.notifyChange({
            action: "remove",
            items,
        });
    }

    get length() {
        return this._items.length;
    }

    /**
     * Replace an item at a specific index with one or more new items.
     * In CAD: Used when updating object properties that require a replacement
     *         (e.g., converting a line to a spline, substituting a symbol reference).
     * Notifies observers with the old item and new items so UI can update.
     */
    replace(index: number, ...items: T[]) {
        if (!this.isValidIndex(index)) return;

        const item = this._items[index];
        this._items.splice(index, 1, ...items);
        this.notifyChange({
            action: "replace",
            index,
            item,
            items,
        });
    }

    private isValidIndex(index: number): boolean {
        return index >= 0 && index < this._items.length;
    }

    /**
     * Internal method that broadcasts all collection changes to subscribers
     * and syncs the "length" property to the Observable base class.
     *
     * This is the heart of the reactive pattern:
     *   1. All mutation methods (push, remove, move, replace, clear) call this
     *   2. All registered callbacks are invoked with detailed change info
     *   3. The "length" property is synced, triggering dependent observers
     *   4. Enables cascading notifications (e.g., scene changes → update rendering)
     *
     * The synced "length" property allows the properties panel to show
     * "3 objects selected" and update it automatically as selection changes.
     */
    private notifyChange(args: CollectionChangedArgs) {
        this._callbacks.forEach((callback) => callback(args));

        if (args.action === "add") {
            this.emitPropertyChanged("length", this.length - args.items.length);
        } else if (args.action === "remove") {
            this.emitPropertyChanged("length", this.length + args.items.length);
        } else if (args.action === "replace") {
            this.emitPropertyChanged("length", this.length - 1 + args.items.length);
        }
    }

    forEach(callback: (item: T, index: number) => void) {
        this._items.forEach(callback);
    }

    map(callback: (item: T, index: number) => any) {
        return this._items.map(callback);
    }

    items() {
        return Array.from(this._items);
    }

    [Symbol.iterator]() {
        return this._items[Symbol.iterator]();
    }

    item(index: number) {
        return this._items[index];
    }

    at(index: number) {
        return this._items.at(index);
    }

    filter(predicate: (value: T, index: number, array: T[]) => boolean) {
        return this._items.filter(predicate);
    }

    find(predicate: (value: T, index: number, array: T[]) => boolean) {
        return this._items.find(predicate);
    }

    indexOf(item: T, fromIndex?: number) {
        return this._items.indexOf(item, fromIndex);
    }

    contains(item: T) {
        return this._items.indexOf(item) !== -1;
    }

    onCollectionChanged(callback: (args: CollectionChangedArgs) => void): void {
        this._callbacks.add(callback);
    }

    removeCollectionChanged(callback: (args: CollectionChangedArgs) => void): void {
        this._callbacks.delete(callback);
    }

    override disposeInternal() {
        super.disposeInternal();

        this._callbacks.clear();
        this._items.length = 0;
    }
}

/**
 * SelectMode defines how many items can be selected simultaneously.
 *   - "radio": Only one item at a time (e.g., active layer)
 *   - "check": Multiple items can be selected (e.g., objects in viewport)
 *   - "combo": Combination mode (e.g., filter + display options)
 */
export type SelectMode = "check" | "radio" | "combo";

/**
 * SelectableItems<T> - Manages selection state for multi-select UI components.
 *
 * CRITICAL for CAD because:
 *
 * 1. Multi-select in the viewport
 *    - User selects multiple objects to edit/delete/transform together
 *    - SelectableItems maintains which objects are selected
 *    - Can easily query "get all selected objects" or "is object selected?"
 *
 * 2. Properties panel updates
 *    - When selection changes, properties panel shows attributes of selected objects
 *    - selectedIndexes property enables quick range updates in UI
 *
 * 3. Context-sensitive tools
 *    - Selection mode determines tool behavior
 *    - "radio" mode: Tools operate on single object (e.g., text editing)
 *    - "check" mode: Tools operate on group (e.g., move, scale, rotate)
 *
 * 4. Selection filters in layers panel
 *    - Different SelectMode for different panels
 *    - Maintains independent selection state per UI component
 *    - "combo" for filter combinations (show/hide/lock layers)
 *
 * Example: Multi-select rotation in viewport
 *   - User Ctrl+clicks multiple objects
 *   - Each click updates selectedItems Set
 *   - Rotation tool reads selectedItems and transforms them all together
 *   - User releases mouse, transformation completes
 */
export class SelectableItems<T> {
    readonly items: ReadonlyArray<T>;
    selectedItems: Set<T>;

    get selectedIndexes(): number[] {
        const indexes: number[] = [];
        this.selectedItems.forEach((x) => {
            const index = this.items.indexOf(x);
            if (index > -1) {
                indexes.push(index);
            }
        });
        return indexes;
    }

    firstSelectedItem() {
        return this.selectedItems.values().next().value;
    }

    constructor(
        items: T[],
        readonly mode: SelectMode = "radio",
        selectedItems?: T[],
    ) {
        this.items = items;
        this.selectedItems = new Set(selectedItems ?? []);
    }
}
