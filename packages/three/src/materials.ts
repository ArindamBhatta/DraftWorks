import { Config, type LineType, VisualConfig, type VisualItemConfig } from "@draftworks/core";
import {
    Color,
    DoubleSide,
    type Material,
    MeshBasicMaterial,
    MeshLambertMaterial,
    PointsMaterial,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { ThreeHelper } from "./threeHelper";

export const defaultVertexMaterial = new PointsMaterial({
    color: ThreeHelper.fromColor(VisualConfig.defaultEdgeColor),
    sizeAttenuation: false,
    size: 3,
});

export const highlightVertexMaterial = new PointsMaterial({
    color: ThreeHelper.fromColor(VisualConfig.highlightEdgeColor),
    sizeAttenuation: false,
    size: 5,
});

export const selectedVertexMaterial = new PointsMaterial({
    color: ThreeHelper.fromColor(VisualConfig.selectedEdgeColor),
    sizeAttenuation: false,
    size: 5,
});

export const defaultEdgeMaterial = new LineMaterial({
    linewidth: 1,
    color: VisualConfig.defaultEdgeColor,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
});

/**
 * The dash/gap length (in drawing units, before `VisualConfig.lineTypeScale`) of every
 * linetype but "solid". AutoCAD's own DASHED/HIDDEN/DOT differ mainly in how short the
 * dash is relative to the gap - HIDDEN is DASHED cut in half, DOT is barely a dash at all.
 * If a drawing's real-world scale makes these read as solid (too fine) or as scattered
 * dots (too coarse), that is what `lineTypeScale` (AutoCAD's LTSCALE) is for.
 */
const LineDashPatterns: Partial<Record<LineType, { dashSize: number; gapSize: number }>> = {
    dash: { dashSize: 30, gapSize: 30 },
    hidden: { dashSize: 15, gapSize: 15 },
    dot: { dashSize: 3, gapSize: 15 },
};

/**
 * Sets a material's dash pattern from a linetype. Exported because dimensions build
 * their own materials rather than taking one from the layer cache - a dimension's line
 * work carries the *style's* linetype, not its layer's.
 */
export function applyLineType(material: LineMaterial, lineType: LineType) {
    const pattern = LineDashPatterns[lineType];
    material.dashed = pattern !== undefined;
    if (pattern) {
        material.dashScale = VisualConfig.lineTypeScale;
        material.dashSize = pattern.dashSize;
        material.gapSize = pattern.gapSize;
    }
}

/**
 * One shared LineMaterial per layer colour and linetype. Layers (and linetypes) are few
 * and long-lived, so caching keeps a drawing with thousands of objects down to a handful
 * of materials instead of one per object.
 */
const layerEdgeMaterials = new Map<string, LineMaterial>();

/**
 * The width an edge is actually drawn at - AutoCAD's LWDISPLAY, applied here rather than
 * at the geometry.
 *
 * `linewidth` is a plain uniform on LineMaterial, so it can be changed on a live material
 * and take effect on the next frame. That is what lets the LWT button be a single pass
 * over this cache instead of a rebuild of every object's geometry: the cache key keeps
 * the *assigned* weight, and this decides what that weight renders as.
 */
function renderedLineWidth(lineWeight: number) {
    return Config.instance.showLineWeight ? lineWeight : 1;
}

/** The assigned weight for a cached material, read back out of its key. */
function assignedLineWeight(key: string) {
    return Number(key.split(":")[2]);
}

/**
 * The edge material for a layer colour and linetype. A negative colour means "follow the
 * drawing's default edge colour" (LAYER_COLOR_BY_THEME); solid + that sentinel is the
 * single shared, theme-aware `defaultEdgeMaterial`.
 */
export function layerEdgeMaterial(
    color: number,
    lineType: LineType = "solid",
    lineWeight = 1,
    transparency = 0,
): LineMaterial {
    if (color < 0 && lineType === "solid" && lineWeight === 1 && transparency === 0) {
        return defaultEdgeMaterial;
    }

    const key = `${color}:${lineType}:${lineWeight}:${transparency}`;
    let material = layerEdgeMaterials.get(key);
    if (!material) {
        const opacity = 1 - transparency / 100;
        material = new LineMaterial({
            linewidth: renderedLineWidth(lineWeight),
            color: color < 0 ? VisualConfig.defaultEdgeColor : color,
            side: DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
            // `transparent` has to be set up front: three compiles it into the shader,
            // so flipping it on a live material would not take effect.
            transparent: opacity < 1,
            opacity,
        });
        applyLineType(material, lineType);
        layerEdgeMaterials.set(key, material);
    }
    return material;
}

VisualConfig.onPropertyChanged((property: keyof VisualItemConfig) => {
    if (property === "defaultEdgeColor") {
        defaultEdgeMaterial.color.set(VisualConfig.defaultEdgeColor);
        layerEdgeMaterials.forEach((material, key) => {
            if (key.startsWith("-1:")) material.color.set(VisualConfig.defaultEdgeColor);
        });
    } else if (property === "lineTypeScale") {
        layerEdgeMaterials.forEach((material) => {
            material.dashScale = VisualConfig.lineTypeScale;
        });
    }
});

// LWT. Every cached material is re-widened or flattened in place; the assigned weight is
// never lost, because it is the cache key rather than the uniform.
Config.instance.onPropertyChanged((property) => {
    if (property !== "showLineWeight") return;

    layerEdgeMaterials.forEach((material, key) => {
        material.linewidth = renderedLineWidth(assignedLineWeight(key));
    });
});

export const hilightEdgeMaterial = new LineMaterial({
    linewidth: 3,
    color: ThreeHelper.fromColor(VisualConfig.highlightEdgeColor),
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
});

export const hilightDashedEdgeMaterial = new LineMaterial({
    linewidth: 3,
    color: ThreeHelper.fromColor(VisualConfig.highlightEdgeColor),
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    dashed: true,
    dashScale: 100,
    dashSize: 100,
    gapSize: 100,
});

/**
 * The selection dash, in **pixels**. AutoCAD shows a selected object as a dashed
 * line, and that is the cue this copies: colour alone says "this line is blue",
 * which a drawing full of blue lines on a blue layer cannot answer, whereas a dash
 * cutting across an object's own linetype is unmistakable and survives being
 * printed, screenshotted, or looked at by someone who cannot separate the hues.
 *
 * Pixels rather than drawing units because this is cursor feedback, not a drafting
 * linetype (contrast `LineDashPatterns` above, which is deliberately in drawing
 * units so LTSCALE can govern it): the pattern has to read the same however far in
 * you are zoomed. `setScreenDashScale` is what holds it there.
 */
const SELECTION_DASH_PIXELS = 10;
const SELECTION_GAP_PIXELS = 6;

export const selectedEdgeMaterial = new LineMaterial({
    linewidth: 3,
    color: ThreeHelper.fromColor(VisualConfig.selectedEdgeColor),
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    dashed: true,
    dashSize: SELECTION_DASH_PIXELS,
    gapSize: SELECTION_GAP_PIXELS,
    dashScale: 1,
});

/**
 * TRIM's dots, in pixels, for the same reason the selection dash is: they are cursor
 * feedback and have to read the same at any zoom. Short and evenly spaced so they read
 * as dots, not as a dash - a stretch about to go must not look like a selected object,
 * or like one drawn in a dashed linetype.
 */
const DOT_PIXELS = 2;
const DOT_GAP_PIXELS = 3;

const dottedMaterials = new Map<LineMaterial, LineMaterial>();

let screenPixelsPerUnit = 1;

/**
 * A line material's dotted twin, for the stretch TRIM is about to take away. It keeps the
 * original's colour and weight, so the dots read as the same object, going.
 *
 * Kept per original and re-read from it on every call, for the reasons given at
 * fadedMaterial - originals are few, long-lived and change in place.
 */
export function dottedMaterial(base: LineMaterial): LineMaterial {
    let dotted = dottedMaterials.get(base);
    if (!dotted) {
        const twin = base.clone();
        twin.dashed = true;
        twin.dashSize = DOT_PIXELS;
        twin.gapSize = DOT_GAP_PIXELS;
        twin.dashScale = screenPixelsPerUnit;
        dottedMaterials.set(base, twin);
        const release = () => {
            base.removeEventListener("dispose", release);
            dottedMaterials.delete(base);
            twin.dispose();
        };
        base.addEventListener("dispose", release);
        dotted = twin;
    }

    // Property by property, never copy() - see fadedMaterial.
    dotted.color.copy(base.color);
    dotted.linewidth = base.linewidth;
    dotted.opacity = base.opacity;
    return dotted;
}

/**
 * Pins every pixel-sized dash - the selection dash and TRIM's dots - to a fixed
 * on-screen size, given the view's current pixels-per-drawing-unit.
 *
 * three measures a dash along the line in drawing units and then multiplies by
 * `dashScale`, so feeding it the zoom makes `dashSize`/`gapSize` read as pixels.
 * Without this a selected object goes solid when you zoom out and turns into one
 * long dash when you zoom in - which is exactly when you most need to see what you
 * have got hold of. Called from the view's render tick.
 */
export function setScreenDashScale(pixelsPerUnit: number) {
    if (pixelsPerUnit <= 0) return;

    screenPixelsPerUnit = pixelsPerUnit;
    selectedEdgeMaterial.dashScale = pixelsPerUnit;
    dottedMaterials.forEach((material) => {
        material.dashScale = pixelsPerUnit;
    });
}

// Selection and highlight faces are cursor feedback, not surfaces, so they are drawn
// unlit (Basic rather than Lambert). Shading them multiplied the configured colour
// down by whatever the lights happened to contribute, which is why a bright colour
// set in VisualConfig used to arrive on screen looking dark and muddy.
export const faceTransparentMaterial = new MeshBasicMaterial({
    transparent: true,
    side: DoubleSide,
    color: ThreeHelper.fromColor(VisualConfig.selectedFaceColor),
    opacity: 0.1,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
});

export const selectedFaceColoredMaterial = new MeshBasicMaterial({
    side: DoubleSide,
    color: ThreeHelper.fromColor(VisualConfig.selectedFaceColor),
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
});

export const highlightFaceMaterial = new MeshBasicMaterial({
    color: ThreeHelper.fromColor(VisualConfig.highlightFaceColor),
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
});

/**
 * How strongly an object under ERASE's pickbox is drawn. Half, not gone: the user has
 * to be able to see what they are about to lose, and a line that has vanished cannot
 * be checked before the click.
 */
export const FADED_OPACITY = 0.5;

const fadedMaterials = new WeakMap<Material, Material>();

/**
 * A material's half-strength twin, for VisualStates.faded - the object keeps its own
 * colour, linetype and weight, only fainter, which is what separates "this will be
 * erased" from the recolour a hover highlight gives.
 *
 * One twin per material, made once and kept: `transparent` is compiled into the shader
 * (see layerEdgeMaterial), so it can only be set before the twin is first drawn. The
 * look is re-read from the original on every call instead, because originals change in
 * place - a theme switch recolours defaultEdgeMaterial, LWT re-widens the layer cache.
 */
export function fadedMaterial<T extends Material>(base: T): T {
    let faded = fadedMaterials.get(base) as T | undefined;
    if (!faded) {
        const twin = base.clone();
        twin.transparent = true;
        fadedMaterials.set(base, twin);
        const release = () => {
            base.removeEventListener("dispose", release);
            fadedMaterials.delete(base);
            twin.dispose();
        };
        base.addEventListener("dispose", release);
        faded = twin;
    }

    if (faded instanceof LineMaterial && base instanceof LineMaterial) {
        // Property by property, never copy(): that would swap out the uniforms object
        // the compiled program is already bound to.
        faded.color.copy(base.color);
        faded.linewidth = base.linewidth;
        faded.dashed = base.dashed;
        faded.dashScale = base.dashScale;
        faded.dashSize = base.dashSize;
        faded.gapSize = base.gapSize;
    } else if (
        "color" in faded &&
        faded.color instanceof Color &&
        "color" in base &&
        base.color instanceof Color
    ) {
        faded.color.copy(base.color);
    }
    faded.opacity = base.opacity * FADED_OPACITY;
    return faded;
}

export const lockFaceMaterial = new MeshLambertMaterial({
    color: 0x6a6a6a,
    transparent: true,
    opacity: 0.5,
});

export const lockLineMaterial = new LineMaterial({
    color: 0x6a6a6a,
    transparent: true,
    opacity: 0.5,
});
