/**
 * One of the objects stacked under a click, as offered by selection cycling.
 *
 * The callbacks rather than the objects themselves, because what a pick or a hover has to
 * do is the selection handler's business - the menu's job is only to say which row the
 * pointer is on. That also keeps the visual layer out of `core/ui`, which is types only.
 */
export interface SelectionCycleItem {
    /** What the row reads, e.g. "Line" or "Circle". */
    name: string;
    /** The object's layer, shown beside the name to tell two of a kind apart. */
    detail?: string;
    /** Light this one up in the drawing - the pointer is over its row. */
    onHover: () => void;
    /** Take this one. The menu closes itself afterwards. */
    onPick: () => void;
}

/**
 * AutoCAD's selection cycling list: what to show, and where.
 *
 * Positioned in client coordinates because it is placed against the pointer, which is
 * where the stack of objects is - a menu that opened in a corner would mean looking away
 * from the thing being chosen.
 */
export interface SelectionCycleOptions {
    items: SelectionCycleItem[];
    clientX: number;
    clientY: number;
    /** Dismissed without choosing - Escape, or a click elsewhere. */
    onCancel: () => void;
}
