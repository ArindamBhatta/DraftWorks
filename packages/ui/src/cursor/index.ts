import { Config, type CursorType } from "@draftworks/core";

/**
 * 32 is the ceiling, not a preference: Firefox ignores cursor images larger than
 * 32x32 on some platforms and silently falls back to the keyword cursor, so anything
 * bigger would render as a plain crosshair for those users while looking correct in
 * Chrome. The hotspot has to land on the centre line, so SIZE must stay even.
 *
 * The long crosshair arms are no longer drawn here - they are a viewport overlay now
 * (see Crosshair), which is free of this 32px cap and can reach across the screen the
 * way AutoCAD's CURSORSIZE does. What stays in the cursor image is the pickbox: a small
 * square pinned to the hotspot, where the browser places it to the sub-pixel without an
 * overlay having to chase the pointer to keep it centred.
 */
const SIZE = 32;
const CENTER = SIZE / 2;

/**
 * ERASE's badge: AutoCAD's red cross, below and right of the pickbox. It has to clear
 * the box - it rides along with the pick, it is not what picks.
 *
 * Red rather than the pointer's white, because the colour is the message: this pick
 * destroys. That keeps it out of the white pass below, so it is painted on its own,
 * with the same dark edge under it that keeps the white lines readable on a light
 * canvas.
 */
const CROSS_PATH = `<path d="M23 23 L30 30 M30 23 L23 30" fill="none" />`;
const CROSS =
    `<g stroke="#000" stroke-opacity="0.55" stroke-width="4" stroke-linecap="round">${CROSS_PATH}</g>` +
    `<g stroke="#ff3b30" stroke-width="2" stroke-linecap="round">${CROSS_PATH}</g>`;

/**
 * AutoCAD's drawing-area pointers. There are three, and which one is showing is how a
 * draftsman knows what the program is waiting for without reading the prompt:
 *
 *   - idle, nothing running: crosshair **and** pickbox
 *   - a command asking for a point: crosshair **only** - you are aiming, not picking
 *   - a command asking for objects: pickbox **only** - you are picking, not aiming
 *
 * The last of those is the one to be careful about. Leaving the crosshair up during
 * "Select objects" tells the user they are placing a point when they are not, which
 * is exactly the confusion MOVE used to cause here.
 *
 * The crosshair arms are drawn by the Crosshair overlay, which reads the same `crosshair`
 * flag off the active cursor type; this image carries only the pickbox (and ERASE's
 * cross). Drawn as an SVG data URI rather than a .cur file so it stays crisp at any DPI.
 * Every stroke is painted twice - a wide black pass under a thin white pass - so the box
 * stays visible against both the light and the dark canvas without two themed variants.
 *
 * `pickbox` is the box's edge length in pixels; the caller passes Config's pickboxSize so
 * a `PICKBOX` change rebuilds the cursor at the new size.
 */
function pointer(parts: { crosshair: boolean; pickbox: boolean; cross?: boolean }, pickbox: number) {
    const half = pickbox / 2;
    const box = parts.pickbox
        ? `<rect x="${CENTER - half}" y="${CENTER - half}" width="${pickbox}" height="${pickbox}" fill="none" />`
        : "";
    const markup =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
        `<g stroke="#000" stroke-opacity="0.55" stroke-width="3">${box}</g>` +
        `<g stroke="#fff" stroke-width="1">${box}</g>` +
        (parts.cross ? CROSS : "") +
        `</svg>`;
    // The keyword fallback matches the shape: a picking pointer falls back to the arrow,
    // an aiming one to the crosshair keyword the overlay would otherwise stand in for.
    const fallback = parts.crosshair ? "crosshair" : "default";
    return `url("data:image/svg+xml,${encodeURIComponent(markup)}") ${CENTER} ${CENTER}, ${fallback}`;
}

/** Which parts each cursor type draws - read by both this image and the Crosshair overlay. */
export const CursorParts: Record<CursorType, { crosshair: boolean; pickbox: boolean; cross?: boolean }> = {
    default: { crosshair: true, pickbox: true },
    "select.default": { crosshair: true, pickbox: true },
    "select.objects": { crosshair: false, pickbox: true },
    "select.erase": { crosshair: false, pickbox: true, cross: true },
    draw: { crosshair: true, pickbox: false },
    // Panning has no drawing pointer at all; the browser's grab/grabbing keyword is it.
    pan: { crosshair: false, pickbox: false },
    "pan.active": { crosshair: false, pickbox: false },
};

const keywordCursors: Partial<Record<CursorType, string>> = {
    pan: "grab",
    "pan.active": "grabbing",
};

export class Cursor {
    /**
     * The CSS cursor for a type, built at the current pickbox size. Rebuilt on each call
     * rather than cached, so a `PICKBOX` change is picked up the next time the cursor is
     * set - which the viewport does on the config change (see LayoutViewport).
     */
    static get(type: CursorType) {
        const keyword = keywordCursors[type];
        if (keyword) return keyword;
        const parts = CursorParts[type];
        if (!parts) return "default";
        return pointer(parts, Config.instance.pickboxSize);
    }
}
