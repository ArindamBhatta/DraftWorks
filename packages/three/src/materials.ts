// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type LineType, VisualConfig, type VisualItemConfig } from "@chili3d/core";
import { DoubleSide, MeshBasicMaterial, MeshLambertMaterial, PointsMaterial } from "three";
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

function applyLineType(material: LineMaterial, lineType: LineType) {
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
            linewidth: lineWeight,
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
 * you are zoomed. `setSelectionDashScale` is what holds it there.
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
 * Pins the selection dash to a fixed on-screen size, given the view's current
 * pixels-per-drawing-unit.
 *
 * three measures a dash along the line in drawing units and then multiplies by
 * `dashScale`, so feeding it the zoom makes `dashSize`/`gapSize` above read as
 * pixels. Without this a selected object goes solid when you zoom out and turns
 * into one long dash when you zoom in - which is exactly when you most need to see
 * what you have got hold of. Called from the view's render tick.
 */
export function setSelectionDashScale(pixelsPerUnit: number) {
    if (pixelsPerUnit > 0) selectedEdgeMaterial.dashScale = pixelsPerUnit;
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
