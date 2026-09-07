/**
 * A visual that paints its own cursor feedback, rather than having the highlighter
 * swap materials on it (which only `ThreeGeometry` supports).
 *
 * `selected` separates the two things AutoCAD draws differently: hovering says "you
 * could pick this", selecting says "you did". Implementations that can show line
 * work answer the second with a dash, matching what the highlighter does to ordinary
 * geometry; ones with no line work to dash (text) may ignore it.
 */
export interface IHighlightable {
    highlight(selected?: boolean): void;
    unhighlight(): void;
}

export function isHighlightable(value: any): value is IHighlightable {
    return value && typeof value.highlight === "function" && typeof value.unhighlight === "function";
}
