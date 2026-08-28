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
export function layerEdgeMaterial(color: number, lineType: LineType = "solid"): LineMaterial {
    if (color < 0 && lineType === "solid") return defaultEdgeMaterial;

    const key = `${color}:${lineType}`;
    let material = layerEdgeMaterials.get(key);
    if (!material) {
        material = new LineMaterial({
            linewidth: 1,
            color: color < 0 ? VisualConfig.defaultEdgeColor : color,
            side: DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
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

export const selectedEdgeMaterial = new LineMaterial({
    linewidth: 3,
    color: ThreeHelper.fromColor(VisualConfig.selectedEdgeColor),
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
});

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
