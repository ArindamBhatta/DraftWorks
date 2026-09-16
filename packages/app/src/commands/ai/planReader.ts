/**
 * Reads what is already on the canvas back out as DrawItems.
 *
 * The exact mirror of aiRenderer.ts, and deliberately the only other place millimetres
 * and drawing units meet. Everything in @draftworks/generators works in millimetres,
 * including the facade extractor this feeds, while the document counts in whatever
 * UnitSetup calls its base unit - so the conversion happens once, here, on the way in.
 *
 * Geometry is read from the kernel shape's edges and each edge is asked what curve it
 * is, rather than matched on node classes. nodesToDxf.ts explains why at length and the
 * reasoning is identical: a LineNode's shape is a line edge and an ArcNode's is a circle
 * edge, so the curve-driven path already reads both - and it keeps working for the
 * shapes with no node class of their own, which is most of what a real drawing
 * accumulates. A plan that has been trimmed, offset and joined into shape is exactly the
 * plan someone wants an elevation of, and matching on node classes would read it as
 * empty.
 */

import {
    DimensionAnnotation,
    type ICircle,
    type IEdge,
    type IEllipse,
    type ITrimmedCurve,
    type Layer,
    ShapeNode,
    ShapeTypes,
    TextAnnotation,
    UnitSetup,
    type VisualNode,
    type XYZ,
} from "@draftworks/core";
import type { DrawItem, Vec2 } from "@draftworks/generators";
import { MM_PER_DRAWING_UNIT } from "@draftworks/generators";
import { ConstructionLineNode } from "../../bodys/constructionLine";

const RAD_TO_DEG = 180 / Math.PI;

/** How closely a curve with no DrawItem equivalent is followed when it has to be sampled. */
const SAMPLE_SEGMENTS = 64;

/** Below this, an arc's two ends are the same point and the curve is a full circle. */
const CLOSED_TOLERANCE = 1e-7;

export interface PlanReadResult {
    items: DrawItem[];
    /**
     * Nodes that were looked at and produced nothing.
     *
     * Reported rather than swallowed, for the same reason the extractor reports its
     * unpaired jambs: a facade read off half a drawing should be able to say so.
     */
    skipped: number;
}

/**
 * Turns document nodes into DrawItems in millimetres.
 *
 * `layers` is the document's layer list, used to resolve each node's layer to a name and
 * to skip the layers that are switched off. Layer names come through as the DrawItem tag
 * so the caller can hand the extractor an `ignoreLayers` set in the drawing's own terms -
 * "A-ANNO-DIMS" rather than an internal id.
 */
export function readPlan(nodes: readonly VisualNode[], layers: readonly Layer[]): PlanReadResult {
    const mmPerUnit = MM_PER_DRAWING_UNIT[UnitSetup.settings.baseUnit];
    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    const at = (p: XYZ): Vec2 => ({ x: p.x * mmPerUnit, y: p.y * mmPerUnit });

    const items: DrawItem[] = [];
    let skipped = 0;

    for (const node of nodes) {
        const layer = byId.get(node.layerId);
        if (layer && !layer.visible) continue;

        // Dimensions are not the building. They are also the one thing in a plan that
        // most looks like it: a dimension line runs parallel to the wall it measures,
        // the full length of it, just outside - which is the shape of the mistake the
        // extractor's pair rule exists to catch. Not handing them over is cheaper and
        // more certain than catching them downstream.
        if (node instanceof DimensionAnnotation) continue;

        // Construction lines are unbounded. Whatever length the kernel gives one is
        // arbitrary, so it would read as a wall face spanning the entire drawing.
        if (node instanceof ConstructionLineNode) continue;

        const tag = layer?.name ?? "0";
        const before = items.length;

        if (node instanceof TextAnnotation) {
            readText(node, tag, at, mmPerUnit, items);
        } else if (node instanceof ShapeNode) {
            readShape(node, tag, at, mmPerUnit, items);
        }

        if (items.length === before) skipped += 1;
    }

    return { items, skipped };
}

function readText(
    node: TextAnnotation,
    layer: string,
    at: (p: XYZ) => Vec2,
    mmPerUnit: number,
    items: DrawItem[],
): void {
    if (!node.content) return;
    items.push({
        kind: "text",
        layer,
        at: at(node.position),
        text: node.content,
        heightMm: node.height * mmPerUnit,
        rotationDeg: node.rotation,
    });
}

/**
 * There is deliberately no bounding-box pre-filter here.
 *
 * An obvious optimisation - skip the nodes whose box misses the picked window - and it
 * was wrong. `GeometryNode.boundingBox()` is built from the node's own `transform`, while
 * the geometry below is baked with `worldTransform()`, which is that transform composed
 * with every ancestor's. The two agree only while the folders above the node sit at the
 * origin, so a plan that had been moved or rotated after it was drawn had its geometry
 * discarded as outside a window it was sitting in the middle of.
 *
 * Reading every visible node instead. The extractor clips exactly, these are 2D drawings,
 * and a filter that is right is worth more than a filter that is fast.
 */
function readShape(
    node: ShapeNode,
    layer: string,
    at: (p: XYZ) => Vec2,
    mmPerUnit: number,
    items: DrawItem[],
): void {
    const result = node.shape;
    if (!result.isOk) return;

    // Baked into world coordinates, exactly as the DXF writer does it. A node inside a
    // moved or rotated folder carries that transform on the visual rather than in the
    // shape, and reading the raw shape would put the wall somewhere it is not drawn.
    const shape = result.value.transformedMul(node.worldTransform());

    // Every edge individually, with no wire grouping. The DXF writer bothers to rebuild
    // wires as polylines because DXF readers prefer them; nothing downstream of here
    // cares, and the extractor explodes polylines back into segments as its first act.
    for (const edge of shape.findSubShapes(ShapeTypes.edge) as IEdge[]) {
        readEdge(edge, layer, at, mmPerUnit, items);
    }
}

const basisOf = (curve: ITrimmedCurve): ITrimmedCurve => (curve.basisCurve as ITrimmedCurve) ?? curve;

export function readEdge(
    edge: IEdge,
    layer: string,
    at: (p: XYZ) => Vec2,
    mmPerUnit: number,
    items: DrawItem[],
): void {
    const curve = edge.curve;
    const start = curve.startPoint();
    const end = curve.endPoint();

    switch (basisOf(curve).curveType) {
        case "line":
            items.push({ kind: "line", layer, a: at(start), b: at(end) });
            return;

        case "circle": {
            const circle = basisOf(curve) as unknown as ICircle;
            if (start.distanceTo(end) < CLOSED_TOLERANCE) {
                items.push({
                    kind: "circle",
                    layer,
                    center: at(circle.center),
                    radiusMm: circle.radius * mmPerUnit,
                });
                return;
            }
            const sweepDeg = sweepOf(circle, start, end);
            if (sweepDeg === undefined) {
                sample(edge, layer, at, items);
                return;
            }
            items.push({ kind: "arc", layer, center: at(circle.center), start: at(start), sweepDeg });
            return;
        }

        case "ellipse": {
            const ellipse = basisOf(curve) as unknown as IEllipse;
            const xAxis = ellipse.xAxis;
            // A DrawItem ellipse is a whole ellipse at a rotation; a trimmed one is an
            // elliptical arc, which it cannot say. Sampling keeps the geometry rather
            // than silently closing it.
            const closed = start.distanceTo(end) < CLOSED_TOLERANCE;
            if (!closed) {
                sample(edge, layer, at, items);
                return;
            }
            items.push({
                kind: "ellipse",
                layer,
                center: at(ellipse.center),
                radiusXMm: ellipse.majorRadius * mmPerUnit,
                radiusYMm: ellipse.minorRadius * mmPerUnit,
                rotationDeg: Math.atan2(xAxis.y, xAxis.x) * RAD_TO_DEG,
            });
            return;
        }

        default:
            sample(edge, layer, at, items);
    }
}

/**
 * The signed sweep from `start` to `end`, in degrees, positive counter-clockwise in the
 * drawing's own frame.
 *
 * The kernel measures an arc counter-clockwise about its own axis, which is not the
 * drawing's: an arc drawn clockwise is stored as a counter-clockwise one about a
 * downward axis. DrawItem has no axis and signs the sweep instead, so the axis has to be
 * turned back into that sign here - the same conversion nodesToDxf does by swapping the
 * arc's ends, arrived at from the other direction.
 *
 * Returns undefined for an arc standing on edge to the drawing, which has no honest
 * 2D sweep at all and is sampled by the caller instead.
 */
export function sweepOf(circle: ICircle, start: XYZ, end: XYZ): number | undefined {
    const axis = circle.axis;
    if (Math.abs(axis.z) < CLOSED_TOLERANCE) return undefined;

    const angleAt = (point: XYZ) => {
        const radial = point.sub(circle.center);
        return Math.atan2(radial.dot(circle.yAxis), radial.dot(circle.xAxis));
    };

    let sweep = angleAt(end) - angleAt(start);
    // Normalised into (0, 2pi]: the kernel's own direction is always the positive one
    // about its axis, so a difference that came out negative simply wrapped.
    while (sweep <= 0) sweep += 2 * Math.PI;

    return sweep * RAD_TO_DEG * (axis.z >= 0 ? 1 : -1);
}

function sample(edge: IEdge, layer: string, at: (p: XYZ) => Vec2, items: DrawItem[]): void {
    const points = edge.curve.uniformAbscissaByCount(SAMPLE_SEGMENTS);
    if (points.length < 2) return;

    const closed = points[0].distanceTo(points[points.length - 1]) < CLOSED_TOLERANCE;
    items.push({
        kind: "polyline",
        layer,
        // A closed run repeats nothing in a DrawItem, so the duplicated last point the
        // sampler returns has to come off or the polyline closes onto a zero-length edge.
        points: (closed ? points.slice(0, -1) : points).map(at),
        closed,
    });
}
