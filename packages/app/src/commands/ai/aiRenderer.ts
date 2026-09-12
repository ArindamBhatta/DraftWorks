import {
    FolderNode,
    type IDocument,
    type INode,
    type Layer,
    type Plane,
    TextAnnotation,
    Transaction,
    UnitSetup,
    type VisualNode,
    XYZ,
} from "@draftworks/core";
import type { DrawItem, LayerSpec, Vec2 } from "@draftworks/generators";
import { MM_PER_DRAWING_UNIT } from "@draftworks/generators";
import { ArcNode } from "../../bodys/arc";
import { CircleNode } from "../../bodys/circle";
import { EllipseNode } from "../../bodys/ellipse";
import { LineNode } from "../../bodys/line";
import { PolygonNode } from "../../bodys/polygon";

/**
 * What the renderer needs to know about whatever produced the drawing. A Generator
 * satisfies it as-is, and so does a freeform drawing the model emitted - which is the
 * point: everything below this line is the same either way.
 */
export interface DrawingSource {
    title: string;
    layers: LayerSpec[];
}

/**
 * Puts a generated drawing into the document.
 *
 * This is the only place millimetres become drawing units. Generators work in
 * millimetres throughout, because a plan is a physical thing; the document counts in
 * whatever UnitSetup calls its base unit, and mixing the two anywhere else is how a
 * drawing ends up 25.4 or 1000 times the size it should be.
 */
export function insertDrawing(
    document: IDocument,
    source: DrawingSource,
    items: DrawItem[],
    workplane: Plane,
    replacing?: FolderNode,
): FolderNode {
    const perMm = 1 / MM_PER_DRAWING_UNIT[UnitSetup.settings.baseUnit];
    const at = (p: Vec2) => new XYZ({ x: p.x * perMm, y: p.y * perMm, z: 0 });

    let folder!: FolderNode;
    Transaction.execute(document, source.title, () => {
        const layers = new Map<string, Layer>();
        for (const spec of source.layers) {
            layers.set(spec.tag, ensureLayer(document, spec));
        }

        folder = new FolderNode({ document, name: source.title });
        const nodes = items.map((item) => {
            const layer = layers.get(item.layer);
            const node = nodeFor(document, item, at, perMm, workplane, layer);
            // The node is not in the tree yet, so this is part of creating it rather
            // than an edit of it - the same reasoning as OffsetCommand's copy. Setting
            // modelManager.currentLayerId instead would not be undoable.
            node.setPrivateValue("layerId", layer?.id ?? node.layerId);
            node.setPrivateValue("name", nameFor(item));
            return node as INode;
        });
        folder.add(...nodes);

        // Replacing rather than stacking, so refining a drawing stays one undo step.
        replacing?.parent?.remove(replacing);
        document.modelManager.addNode(folder);
        document.visual.context.refreshLayerStyling();
        document.visual.update();
    });
    return folder;
}

/**
 * Finds the generator's layer, or makes it. Reusing by name matters: addLayer
 * uniquifies, so drawing a second plan would otherwise scatter it across WALL1, DOOR1
 * and so on instead of landing on the layers the first one made.
 */
export function ensureLayer(document: IDocument, spec: LayerSpec): Layer {
    const existing = document.modelManager.layers.find((layer) => layer.name === spec.name);
    if (existing) return existing;

    const layer = document.modelManager.addLayer(spec.name);
    layer.color = spec.color;
    return layer;
}

function nameFor(item: DrawItem): string {
    if (item.kind === "text") return "Label";
    return item.layer.charAt(0) + item.layer.slice(1).toLowerCase();
}

/**
 * Splits an axis-aligned-plus-rotation ellipse into the major/minor pair OCCT wants.
 *
 * gp_Elips raises if the major radius is the smaller of the two, so an ellipse that is
 * taller than it is wide has to be described as a wider one turned a quarter turn. Doing
 * that here keeps DrawItem in the terms a drawing is actually described in.
 */
function ellipseAxes(item: { radiusXMm: number; radiusYMm: number; rotationDeg: number }) {
    const xIsMajor = item.radiusXMm >= item.radiusYMm;
    return {
        majorRadius: xIsMajor ? item.radiusXMm : item.radiusYMm,
        minorRadius: xIsMajor ? item.radiusYMm : item.radiusXMm,
        angleDeg: item.rotationDeg + (xIsMajor ? 0 : 90),
    };
}

function nodeFor(
    document: IDocument,
    item: DrawItem,
    at: (p: Vec2) => XYZ,
    perMm: number,
    workplane: Plane,
    layer: Layer | undefined,
): VisualNode {
    switch (item.kind) {
        case "line":
            return new LineNode({ document, start: at(item.a), end: at(item.b) });
        case "arc":
            // ArcNode.angle is in degrees - the WASM factory converts to radians itself.
            return new ArcNode({
                document,
                normal: XYZ.unitZ,
                center: at(item.center),
                start: at(item.start),
                angle: item.sweepDeg,
            });
        case "circle":
            return new CircleNode({
                document,
                normal: XYZ.unitZ,
                center: at(item.center),
                radius: item.radiusMm * perMm,
            });
        case "ellipse": {
            const { majorRadius, minorRadius, angleDeg } = ellipseAxes(item);
            const rad = (angleDeg * Math.PI) / 180;
            return new EllipseNode({
                document,
                normal: XYZ.unitZ,
                center: at(item.center),
                xvec: new XYZ({ x: Math.cos(rad), y: Math.sin(rad), z: 0 }),
                majorRadius: majorRadius * perMm,
                minorRadius: minorRadius * perMm,
            });
        }
        case "polyline": {
            // shapeFactory.polygon threads an open wire through the points, so closing is
            // repeating the first one rather than a flag it would understand.
            const points = item.points.map(at);
            if (item.closed && points.length > 2) points.push(points[0]);
            return new PolygonNode({ document, points });
        }
        case "text":
            return new TextAnnotation({
                document,
                annotationType: "text",
                name: "Label",
                content: item.text,
                position: at(item.at),
                // Always explicit: the default is the dimension text height, 2.5 drawing
                // units, which on a plan several thousand units wide is invisible.
                height: item.heightMm * perMm,
                rotation: item.rotationDeg,
                boxWidth: 0,
                normal: workplane.normal,
                xAxis: workplane.xvec,
                // Annotations carry their own colour: threeVisualContext.applyLayerStyling
                // only recolours ThreeGeometry, so a label would otherwise ignore the
                // layer it is on. Copy the layer's colour at creation, unless the layer
                // follows the theme - then the annotation default is the right answer.
                ...(layer && !layer.usesThemeColor ? { color: layer.color } : {}),
            });
    }
}
