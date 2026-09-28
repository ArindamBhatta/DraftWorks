import type { CursorType } from "@draftworks/core";

/**
 * 32 is the ceiling, not a preference: Firefox ignores cursor images larger than
 * 32x32 on some platforms and silently falls back to the keyword cursor, so anything
 * bigger would render as a plain crosshair for those users while looking correct in
 * Chrome. The hotspot has to land on the centre line, so SIZE must stay even.
 */
const SIZE = 32;
const CENTER = SIZE / 2;
const PICKBOX = 10;

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
 * Drawn as an SVG data URI rather than a .cur file so it stays crisp at any DPI and can
 * be built for every state from one definition. Every stroke is painted twice - a wide
 * black pass under a thin white pass - so the cursor stays visible against both the
 * light and the dark canvas without needing two themed variants.
 */
function pointer(parts: { crosshair: boolean; pickbox: boolean; cross?: boolean }) {
    const half = PICKBOX / 2;
    // The arms stop short of the box only when both are drawn together.
    const gap = parts.pickbox && parts.crosshair ? half : 0;
    const box = parts.pickbox
        ? `<rect x="${CENTER - half}" y="${CENTER - half}" width="${PICKBOX}" height="${PICKBOX}" fill="none" />`
        : "";
    const arms = parts.crosshair
        ? `<path d="M0 ${CENTER} H${CENTER - gap} M${CENTER + gap} ${CENTER} H${SIZE}
                 M${CENTER} 0 V${CENTER - gap} M${CENTER} ${CENTER + gap} V${SIZE}" fill="none" />`
        : "";
    const shapes = `${arms}${box}`;
    const markup =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
        `<g stroke="#000" stroke-opacity="0.55" stroke-width="3">${shapes}</g>` +
        `<g stroke="#fff" stroke-width="1">${shapes}</g>` +
        (parts.cross ? CROSS : "") +
        `</svg>`;
    // The keyword fallback matches the shape: a bare pickbox is a picking pointer, so
    // it falls back to the arrow rather than to a crosshair it does not draw.
    const fallback = parts.crosshair ? "crosshair" : "default";
    return `url("data:image/svg+xml,${encodeURIComponent(markup)}") ${CENTER} ${CENTER}, ${fallback}`;
}

const cursors: Map<CursorType, string> = new Map([
    ["default", pointer({ crosshair: true, pickbox: true })],
    ["select.default", pointer({ crosshair: true, pickbox: true })],
    ["select.objects", pointer({ crosshair: false, pickbox: true })],
    ["select.erase", pointer({ crosshair: false, pickbox: true, cross: true })],
    ["draw", pointer({ crosshair: true, pickbox: false })],
    ["pan", "grab"],
    ["pan.active", "grabbing"],
]);

export class Cursor {
    static get(type: CursorType) {
        return cursors.get(type) ?? "default";
    }
}
