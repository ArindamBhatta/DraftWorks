// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * AutoCAD's two implicit selection rectangles.
 *
 * Press and drag in empty space and which rectangle you get depends purely on which
 * way you dragged:
 *
 * - drag to the **right** and it is a *window*: only objects lying **completely**
 *   inside the box are picked. Drawn blue, with a solid border.
 * - drag to the **left** and it is a *crossing*: everything the box **touches** is
 *   picked, whether it is inside or merely passes through. Drawn green, with a
 *   dashed border.
 *
 * Only the horizontal direction decides it - dragging up or down changes nothing -
 * which is why `rectSelectMode` looks at x alone. That is not an accident of the UI:
 * it is what lets a drafter pick "just this bolt" and "everything this wall runs
 * through" with the same gesture and no modifier key, and it is muscle memory for
 * anyone who has used AutoCAD, so the colours are worth matching too.
 *
 * Everything here works in **screen pixels**, and is deliberately free of any
 * renderer or camera: projecting geometry to the screen is the caller's job (see
 * `ThreeView.detectShapesRect`), deciding what the rectangle catches is this file's.
 */

export const RectSelectModes = ["window", "crossing"] as const;

export type RectSelectMode = (typeof RectSelectModes)[number];

/**
 * Which rectangle a drag from `startX` to `endX` means. A drag with no horizontal
 * travel at all encloses nothing either way, so the tie goes to `window`.
 */
export function rectSelectMode(startX: number, endX: number): RectSelectMode {
    return endX >= startX ? "window" : "crossing";
}

/** An axis-aligned rectangle in screen pixels, corners already sorted. */
export interface ScreenRect {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Builds a `ScreenRect` from the two drag corners, in either order. */
export function screenRect(x1: number, y1: number, x2: number, y2: number): ScreenRect {
    return {
        minX: Math.min(x1, x2),
        minY: Math.min(y1, y2),
        maxX: Math.max(x1, x2),
        maxY: Math.max(y1, y2),
    };
}

/** An empty rect that swallows nothing, for accumulating a bounding box into. */
export function emptyScreenRect(): ScreenRect {
    return {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
    };
}

/** Grows `rect` in place to include the point, for accumulating a bounding box. */
export function growScreenRect(rect: ScreenRect, x: number, y: number) {
    if (x < rect.minX) rect.minX = x;
    if (y < rect.minY) rect.minY = y;
    if (x > rect.maxX) rect.maxX = x;
    if (y > rect.maxY) rect.maxY = y;
}

export function isScreenRectValid(rect: ScreenRect): boolean {
    return rect.minX <= rect.maxX && rect.minY <= rect.maxY;
}

export function isPointInRect(rect: ScreenRect, x: number, y: number): boolean {
    return x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY;
}

/** True when `inner` lies wholly within `outer` - the window-selection test. */
export function isRectInsideRect(inner: ScreenRect, outer: ScreenRect): boolean {
    return (
        inner.minX >= outer.minX &&
        inner.maxX <= outer.maxX &&
        inner.minY >= outer.minY &&
        inner.maxY <= outer.maxY
    );
}

/** True when the two rectangles share any area - the cheap crossing-selection test. */
export function doRectsOverlap(a: ScreenRect, b: ScreenRect): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Whether a bounding box counts as caught, given the mode. Used where the only
 * thing known about a piece of geometry is its box - see `doesSegmentTouchRect`
 * for the exact test used on real line work.
 */
export function isBoxSelected(mode: RectSelectMode, box: ScreenRect, rect: ScreenRect): boolean {
    return mode === "window" ? isRectInsideRect(box, rect) : doRectsOverlap(box, rect);
}

/**
 * Whether the segment touches the rectangle at all: either endpoint inside, or the
 * segment passing clean through.
 *
 * Liang-Barsky parametric clipping - walk the four half-planes of the rectangle,
 * narrowing the surviving span `[t0, t1]` of the segment each time, and the segment
 * misses the moment that span collapses. Chosen over a corner-by-corner
 * segment-intersection test because it is branch-light, needs no divisions when the
 * segment is axis-aligned, and gets zero-length segments (a projected point) right
 * for free: both `p` terms are 0, so it reduces to "is the point inside".
 */
export function doesSegmentTouchRect(
    rect: ScreenRect,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    _clipP[0] = -dx;
    _clipP[1] = dx;
    _clipP[2] = -dy;
    _clipP[3] = dy;
    _clipQ[0] = x1 - rect.minX;
    _clipQ[1] = rect.maxX - x1;
    _clipQ[2] = y1 - rect.minY;
    _clipQ[3] = rect.maxY - y1;

    let t0 = 0;
    let t1 = 1;
    for (let i = 0; i < 4; i++) {
        const p = _clipP[i];
        const q = _clipQ[i];
        if (p === 0) {
            // Parallel to this edge: it is either wholly on the inside or wholly out.
            if (q < 0) return false;
            continue;
        }
        const t = q / p;
        if (p < 0) {
            if (t > t1) return false;
            if (t > t0) t0 = t;
        } else {
            if (t < t0) return false;
            if (t < t1) t1 = t;
        }
    }
    return true;
}

// The clip coefficients above, hoisted out of the function. This runs once per line
// segment of every object straddling the rubber band, on every pointermove, so it
// allocates nothing; it is safe to share because the loop that reads them neither
// recurses nor yields.
const _clipP = new Float64Array(4);
const _clipQ = new Float64Array(4);

/** Whether the whole segment lies inside the rectangle - the window test for line work. */
export function isSegmentInRect(rect: ScreenRect, x1: number, y1: number, x2: number, y2: number): boolean {
    return isPointInRect(rect, x1, y1) && isPointInRect(rect, x2, y2);
}

/**
 * Whether the point lies inside the triangle, by the sign of the three edge cross
 * products. This is what lets a crossing window dropped entirely inside a hatch
 * still select it: nothing is crossed, but the box is standing on the fill.
 */
export function isPointInTriangle(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
): boolean {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNegative && hasPositive);
}
