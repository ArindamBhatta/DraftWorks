/**
 * Cursors the drawing area can show. "default" is the idle state over the viewport and
 * is a crosshair, not an arrow - in a drafting app the pointer is a drawing instrument
 * whenever it is over the canvas. See Cursor in packages/ui/src/cursor.
 */
export type CursorType = "default" | "draw" | "select.default" | "pan" | "pan.active";
