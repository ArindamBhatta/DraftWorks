// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CurveType,
    CurveUtils,
    command,
    GeometryNode,
    GetOrSelectNodeStep,
    type ICurve,
    type IEdge,
    type IShape,
    type IStep,
    MultiStepCommand,
    Precision,
    PubSub,
    ShapeNode,
    ShapeNodeFilter,
    ShapeTypes,
    Transaction,
    type VisualNode,
    type XYZ,
} from "@draftworks/core";
import { LineNode } from "../../bodys/line";
import { WireNode } from "../../bodys/wire";

/**
 * The type of the curve underneath an edge's.
 *
 * Worth the indirection: IEdge.curve never answers "line". Edge::curve on the C++
 * side (cpp/src/shape.cpp) always wraps what BRep_Tool hands back in a fresh
 * Geom_TrimmedCurve, so a dead straight edge reports its curveType as
 * "trimmedCurve", and a `curve.curveType === "line"` test silently matches nothing
 * at all. The real type is one level down - and can be two, when the edge was built
 * from a curve that was already trimmed, as Break does. objectSnap reaches through
 * basisCurve for the same reason.
 */
export function basisCurveType(curve: ICurve): CurveType {
    let current: ICurve = curve;
    // Bounded rather than `while`, so a basisCurve that ever pointed at itself would
    // give a wrong answer instead of hanging the command.
    for (let depth = 0; depth < 8 && CurveUtils.isTrimmed(current); depth++) {
        current = current.basisCurve;
    }
    return current.curveType;
}

/**
 * The single straight run covering every one of these points, or undefined if they
 * do not all sit on one infinite line. Gaps are irrelevant - only direction is
 * checked - which is what lets JOIN close a gap between collinear segments.
 */
export function collinearSpan(points: XYZ[]): { start: XYZ; end: XYZ } | undefined {
    if (points.length < 2) return undefined;

    const origin = points[0];
    let direction: XYZ | undefined;
    for (const point of points) {
        direction = point.sub(origin).normalize();
        if (direction) break;
    }
    if (!direction) return undefined; // every point is the same point

    const offsets = points.map((p) => p.sub(origin));
    // isParallelTo counts anti-parallel as parallel, so points on either side of the
    // origin both pass - the origin is just the first endpoint, not an end of the run.
    const onAxis = offsets.every((o) => o.length() < Precision.Distance || o.isParallelTo(direction));
    if (!onAxis) return undefined;

    const parameters = offsets.map((o) => o.dot(direction));
    return {
        start: origin.add(direction.multiply(Math.min(...parameters))),
        end: origin.add(direction.multiply(Math.max(...parameters))),
    };
}

/**
 * AutoCAD's JOIN (J):
 *
 *     Select source object or multiple objects to join at once:
 *
 * Several separate objects become one. AutoCAD decides what that one thing is from
 * what it was given, and this follows the same two rules that matter in 2D:
 *
 *   - collinear lines join into a single LINE, and gaps between them are closed -
 *     the segments do not have to touch. This is the case JOIN exists for: a wall
 *     line broken by an old TRIM, healed back into one object.
 *   - anything else that forms an unbroken chain joins into a polyline.
 *
 * The result inherits the first selected object's layer, colour and linetype, and
 * takes its place in the tree, because joining is meant to leave you with the same
 * drawing minus the seams - not with an object that has quietly moved to the current
 * layer.
 */
@command({
    key: "modify.join",
    icon: "icon-join",
})
export class Join extends MultiStepCommand {
    protected override getSteps(): IStep[] {
        return [
            new GetOrSelectNodeStep("prompt.join.objects", {
                multiple: true,
                filter: new ShapeNodeFilter({
                    allow: (shape: IShape) =>
                        shape.shapeType === ShapeTypes.edge || shape.shapeType === ShapeTypes.wire,
                }),
            }),
        ];
    }

    protected override executeMainTask() {
        const sources = (this.stepDatas[0].nodes ?? []).filter((x): x is ShapeNode => x instanceof ShapeNode);
        if (sources.length < 2) {
            PubSub.default.pub("showToast", "toast.join.needTwo");
            return;
        }

        // Baked into world space up front, so edges from objects sitting under different
        // transforms are all measured in the same frame - and the joined node can then
        // keep an identity transform of its own.
        const edges = sources.flatMap((node) => this.worldEdgesOf(node));
        if (edges.length === 0) return;

        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const joined = this.joinLine(edges) ?? this.joinWire(edges);
            if (!joined) {
                PubSub.default.pub("showToast", "toast.join.failed");
                return;
            }

            this.inherit(joined, sources[0]);
            sources[0].parent?.insertAfter(sources[0].previousSibling, joined);
            sources.forEach((x) => x.parent?.remove(x));

            this.document.visual.update();
        });
    }

    /** A wire source contributes each of its own edges, not itself. */
    private worldEdgesOf(node: ShapeNode): IEdge[] {
        if (!node.shape.isOk) return [];
        const shape = node.shape.value.transformedMul(node.worldTransform());
        if (shape.shapeType === ShapeTypes.edge) return [shape as IEdge];
        return shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    }

    /**
     * Collinear straight edges collapse to the one line that spans them all, gaps
     * included. Returns undefined when that does not apply, so the caller falls
     * through to the polyline case.
     */
    private joinLine(edges: IEdge[]): LineNode | undefined {
        if (!edges.every((x) => basisCurveType(x.curve) === "line")) return undefined;

        const span = collinearSpan(edges.flatMap((x) => [x.curve.startPoint(), x.curve.endPoint()]));
        if (!span) return undefined;

        return new LineNode({ document: this.document, start: span.start, end: span.end });
    }

    /** Anything else has to form an unbroken chain - which is what the wire builder checks. */
    private joinWire(edges: IEdge[]): WireNode | undefined {
        const wire = new WireNode({ document: this.document, edges });
        return wire.generateShape().isOk ? wire : undefined;
    }

    /** The join keeps the look and the layer of the object it was started from. */
    private inherit(joined: VisualNode, source: ShapeNode) {
        joined.layerId = source.layerId;
        if (joined instanceof GeometryNode) {
            joined.materialId = source.materialId;
            joined.lineType = source.lineType;
        }
    }
}
