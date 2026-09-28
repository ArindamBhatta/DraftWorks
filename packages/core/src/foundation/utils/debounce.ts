/**
 * DEBOUNCE - Rate-limit High-Frequency Events
 *
 * Critical for performance in 2D CAD where viewport interactions fire rapidly:
 *
 * Use cases:
 * 1. Viewport pan/zoom: User drags mouse 60+ times per second
 *    - Compute expensive viewport culling → only render visible objects
 *    - Recalculate display lists for GPU rendering
 *    - Debounce by 100ms: only actually recompute/redraw on pause
 *
 * 2. Text input: Property panel coordinate fields
 *    - User types "123.456" character by character
 *    - Debounce: only validate/update model after user stops typing
 *
 * 3. Entity selection: Dragging selection rectangle over 1000 entities
 *    - "didMouseMove" fires for each pixel of drag
 *    - Debounce: only recompute selection on pause/release
 *
 * 4. Undo/Redo history: Each property change could create history entry
 *    - User drags object → position updates 60 times per second
 *    - Debounce: only record final position in history
 *
 * Performance Impact:
 * - Without debounce: viewport pan might cause 60 redraws/second → laggy
 * - With debounce(pan, 16ms): max 1 redraw per 16ms (60 FPS) → smooth
 */

export const debounce = <F extends (...args: any[]) => void, P extends Parameters<F>>(fun: F, ms: number) => {
    let timeout: number | undefined;
    return (...args: P) => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = window.setTimeout(() => {
            fun(...args);
            timeout = undefined;
        }, ms);
    };
};
