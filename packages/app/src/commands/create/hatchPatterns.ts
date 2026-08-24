// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys } from "@chili3d/core";

export type HatchPatternKey = "solid" | "lines" | "brick" | "concrete" | "sand";

export interface HatchPatternDef {
    readonly key: HatchPatternKey;
    readonly display: I18nKeys;
}

/** AutoCAD's HATCH pattern list, trimmed to the handful a student actually reaches for. */
export const HatchPatterns: readonly HatchPatternDef[] = [
    { key: "solid", display: "hatch.pattern.solid" },
    { key: "lines", display: "hatch.pattern.lines" },
    { key: "brick", display: "hatch.pattern.brick" },
    { key: "concrete", display: "hatch.pattern.concrete" },
    { key: "sand", display: "hatch.pattern.sand" },
];

/** One drawing unit tile at hatch scale 1 - the "Scale" property multiplies this. */
export const HATCH_BASE_TILE_SIZE = 10;

/**
 * A data-URI PNG for the pattern: ink drawn opaque white on a transparent field, so a
 * `Material` using it as its `map` tints the ink to the material's own colour and lets
 * the gaps show whatever is behind the face - the same trick a real hatch line achieves
 * by simply not being solid ink everywhere. "solid" needs no texture at all: an
 * untextured `Material` already is a solid fill, which is exactly what AutoCAD's SOLID
 * pattern is.
 */
export function hatchPatternTexture(pattern: HatchPatternKey): string | undefined {
    switch (pattern) {
        case "solid":
            return undefined;
        case "lines":
            return renderTile(64, drawLines);
        case "brick":
            return renderTile(128, drawBrick);
        // The marks are deliberately coarse relative to the tile. A tile is drawn at
        // whatever size the region and scale work out to - often 40-60 screen pixels for
        // a 128px tile - and the texture is mipmapped, so sub-pixel marks average away
        // into flat grey and the pattern reads as "nothing happened".
        case "concrete":
            return renderTile(128, (ctx, size) =>
                drawStipple(ctx, size, { count: 55, minR: 3, maxR: 6.5, seed: 1 }),
            );
        case "sand":
            return renderTile(128, (ctx, size) =>
                drawStipple(ctx, size, { count: 190, minR: 1.6, maxR: 2.8, seed: 2 }),
            );
    }
}

function renderTile(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): string {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    draw(ctx, size);
    return canvas.toDataURL("image/png");
}

/** ANSI31-style parallel 45deg lines - the generic, most common hatch pattern. */
function drawLines(ctx: CanvasRenderingContext2D, size: number) {
    const spacing = size / 4;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(1, size / 48);
    // x0 ranges over 3 tile-widths so a line leaving one edge is already represented by
    // another copy at the opposite edge - the tile repeats seamlessly without needing
    // spacing to divide the tile size evenly.
    for (let x0 = -size; x0 <= size * 2; x0 += spacing) {
        ctx.beginPath();
        ctx.moveTo(x0, size);
        ctx.lineTo(x0 + size, 0);
        ctx.stroke();
    }
}

/** Running-bond brick coursing: two courses, alternating half-brick offset. */
function drawBrick(ctx: CanvasRenderingContext2D, size: number) {
    const rows = 2;
    const cols = 2;
    const rowHeight = size / rows;
    const colWidth = size / cols;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(1, size / 64);

    for (let r = 0; r <= rows; r++) {
        const y = r * rowHeight;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
    }
    for (let r = 0; r < rows; r++) {
        const y0 = r * rowHeight;
        const y1 = y0 + rowHeight;
        const offset = r % 2 === 0 ? 0 : colWidth / 2;
        for (let c = -1; c <= cols; c++) {
            const x = c * colWidth + offset;
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y1);
            ctx.stroke();
        }
    }
}

/** A tiny seeded PRNG so a given pattern comes out the same way every time it is drawn. */
function mulberry32(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** AR-CONC/AR-SAND-style stipple: a scatter of dots, wrapped at the tile edges so the
 * scatter reads as continuous once the texture repeats across the face. */
function drawStipple(
    ctx: CanvasRenderingContext2D,
    size: number,
    options: { count: number; minR: number; maxR: number; seed: number },
) {
    const rand = mulberry32(options.seed);
    ctx.fillStyle = "#fff";
    for (let i = 0; i < options.count; i++) {
        const x = rand() * size;
        const y = rand() * size;
        const r = options.minR + rand() * (options.maxR - options.minR);
        drawWrappedDot(ctx, x, y, r, size);
    }
}

function drawWrappedDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, size: number) {
    for (const dx of [0, -size, size]) {
        for (const dy of [0, -size, size]) {
            const wx = x + dx;
            const wy = y + dy;
            if (wx + r < 0 || wx - r > size || wy + r < 0 || wy - r > size) continue;
            ctx.beginPath();
            ctx.arc(wx, wy, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}
