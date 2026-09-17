import type { I18nKeys } from "@draftworks/core";

export type GradientStyleKey = "linear" | "radial";

export interface GradientStyleDef {
    readonly key: GradientStyleKey;
    readonly display: I18nKeys;
}

/**
 * AutoCAD's GRADIENT offers nine patterns, but they are two shapes - a sweep across the
 * region and a sweep out from its middle - dressed up with preset angles and offsets.
 * Those two are here; the angle they are swept at is a setting of its own.
 */
export const GradientStyles: readonly GradientStyleDef[] = [
    { key: "linear", display: "gradient.style.linear" },
    { key: "radial", display: "gradient.style.radial" },
];

/**
 * The ramp is baked at this many pixels square. It is stretched over the whole region
 * (unlike a hatch tile, which repeats), so this is the resolution of the entire fill -
 * big enough that the steps between colours stay invisible, small enough that the data
 * URI it becomes is a few tens of kilobytes rather than a megabyte.
 */
const GRADIENT_TEXTURE_SIZE = 256;

/**
 * A data-URI PNG of the two-colour ramp, to be used as a `Material`'s `map`.
 *
 * The material carrying it is white and unlit, so what comes out of here is what appears
 * on screen: unlike a hatch pattern - white ink the material tints to the drawing's own
 * colour - a gradient's colours are the thing the user chose, and nothing should be
 * multiplied into them.
 *
 * `angle` is in degrees, counter-clockwise from east, as every other angle in this app
 * is. It is baked into the ramp rather than applied as a texture rotation because the
 * texture is not tiled: rotating it would swing the ramp's own square off the region and
 * leave the corners showing whatever lies outside it.
 */
export function gradientTexture(style: GradientStyleKey, from: string, to: string, angle: number): string {
    const size = GRADIENT_TEXTURE_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const gradient = style === "radial" ? radialRamp(ctx, size) : linearRamp(ctx, size, angle);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    return canvas.toDataURL("image/png");
}

/**
 * Where a ramp at `angle` starts and ends on a `size`-square tile, in canvas coordinates.
 *
 * The end points are the square's own extent measured along the ramp's direction -
 * `|cos| + |sin|` of the half-width - so a diagonal ramp reaches the far corner instead
 * of running out halfway and leaving a flat band of the end colour behind it.
 *
 * Its own function because it is the only arithmetic here that can be wrong in a way a
 * picture of a gradient would not obviously show - see gradientPatterns.test.ts.
 */
export function linearRampEnds(size: number, angle: number) {
    const radians = (angle * Math.PI) / 180;
    // Canvas y grows downward while a face's v axis - and the drawing's own y - grow
    // upward, so the sine is negated to keep "45 degrees" pointing up and to the right.
    const dx = Math.cos(radians);
    const dy = -Math.sin(radians);
    const half = ((Math.abs(dx) + Math.abs(dy)) * size) / 2;
    const center = size / 2;
    return {
        x0: center - dx * half,
        y0: center - dy * half,
        x1: center + dx * half,
        y1: center + dy * half,
    };
}

/** A ramp running across the square at `angle`, ending exactly where the square does. */
function linearRamp(ctx: CanvasRenderingContext2D, size: number, angle: number): CanvasGradient {
    const { x0, y0, x1, y1 } = linearRampEnds(size, angle);
    return ctx.createLinearGradient(x0, y0, x1, y1);
}

/** A ramp out from the middle of the square, reaching the end colour at its edges. */
function radialRamp(ctx: CanvasRenderingContext2D, size: number): CanvasGradient {
    const center = size / 2;
    return ctx.createRadialGradient(center, center, 0, center, center, center);
}
