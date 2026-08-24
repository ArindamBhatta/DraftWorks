// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CursorType } from "@chili3d/core";

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
 * AutoCAD's drawing-area pointer: a crosshair, optionally with the pickbox - the small
 * square at the intersection that shows how close you have to be for an object to be
 * picked. AutoCAD shows the pickbox while you are selecting and drops it while a
 * command is asking for a point, which is what the `withPickbox` flag is for.
 *
 * Drawn as an SVG data URI rather than a .cur file so it stays crisp at any DPI and can
 * be built for both states from one definition. Every stroke is painted twice - a wide
 * black pass under a thin white pass - so the cursor stays visible against both the
 * light and the dark canvas without needing two themed variants.
 */
function crosshair(withPickbox: boolean) {
    const half = PICKBOX / 2;
    const gap = withPickbox ? half : 0;
    const box = withPickbox
        ? `<rect x="${CENTER - half}" y="${CENTER - half}" width="${PICKBOX}" height="${PICKBOX}" fill="none" />`
        : "";
    // Four arms, leaving a gap for the pickbox when it is shown.
    const arms = `
        <path d="M0 ${CENTER} H${CENTER - gap} M${CENTER + gap} ${CENTER} H${SIZE}
                 M${CENTER} 0 V${CENTER - gap} M${CENTER} ${CENTER + gap} V${SIZE}" fill="none" />`;
    const shapes = `${arms}${box}`;
    const markup =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
        `<g stroke="#000" stroke-opacity="0.55" stroke-width="3">${shapes}</g>` +
        `<g stroke="#fff" stroke-width="1">${shapes}</g>` +
        `</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(markup)}") ${CENTER} ${CENTER}, crosshair`;
}

const cursors: Map<CursorType, string> = new Map([
    ["default", crosshair(true)],
    ["select.default", crosshair(true)],
    ["draw", crosshair(false)],
    ["pan", "grab"],
    ["pan.active", "grabbing"],
]);

export class Cursor {
    static get(type: CursorType) {
        return cursors.get(type) ?? "default";
    }
}
