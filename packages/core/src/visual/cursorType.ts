/**
 * Cursors the drawing area can show, and what each one tells the user the program is
 * waiting for - see Cursor in packages/ui/src/cursor for how they are drawn.
 *
 * "default" is the idle state over the viewport and is a crosshair with the pickbox,
 * not an arrow: in a drafting app the pointer is a drawing instrument whenever it is
 * over the canvas. "draw" drops the pickbox while a command asks for a point, and
 * "select.objects" drops the crosshair while a command asks for objects - AutoCAD's
 * bare pickbox, which is how "Select objects:" looks and feels there.
 */
export type CursorType = "default" | "draw" | "select.default" | "select.objects" | "pan" | "pan.active";
