/**
 * Turns selected document nodes into a `DxfDrawing`.
 *
 * Geometry is exported by reading the kernel shape's edges and asking each edge what
 * curve it is, rather than by matching on node classes. That is deliberate: a LineNode's
 * shape is a line edge and a CircleNode's is a circle edge, so the curve-driven path
 * already writes both as their proper DXF entities - and it keeps working for the shapes
 * that have no node class of their own, which is most of what a drawing accumulates
 * (trims, fillets, joins, offsets, booleans). Matching on node classes would have
 * exported those as nothing.
 *
 * Annotations have no kernel shape, so text and dimensions are handled separately below.
 */

import {
    type CurveType,
    DimensionAnnotation,
    type DimensionLineType,
    DimensionSetup,
    type ICircle,
    type IEdge,
    type IEllipse,
    type ITrimmedCurve,
    type IWire,
    type Layer,
    type LineType,
    MathUtils,
    ShapeNode,
    ShapeTypes,
    TextAnnotation,
    UnitSetup,
    type VisualNode,
    type XYZ,
} from "@draftworks/core";
import {
    DXF_LINETYPE_BYLAYER,
    DXF_LINETYPE_CONTINUOUS,
    DXF_UNITS,
    type DxfDrawing,
    type DxfEntity,
    type DxfLayerRecord,
    type DxfPolylineVertex,
    type DxfVec,
    dxfVec,
    emptyDrawing,
    LINE_TYPE_TO_DXF,
    lineWeightToDxf,
} from "./dxfModel";

const RAD_TO_DEG = 180 / Math.PI;

/** How closely a curve with no DXF equivalent is followed when it has to be sampled. */
const SAMPLE_SEGMENTS = 64;

const vec = (p: XYZ): DxfVec => dxfVec(p.x, p.y, p.z);

interface EntityStyle {
    layer: string;
    lineType?: string;
    lineWeight?: number;
    color?: number;
}

export interface DxfExportResult {
    drawing: DxfDrawing;
    /** Nodes that produced no entity, so the caller can say so rather than exporting silently. */
    skipped: number;
}

/**
 * Builds a drawing from `nodes`. `layers` is the document's full layer list: every layer
 * is written, not only the ones in use, so that exporting a selection and reopening it
 * does not quietly discard the drawing's layer setup.
 */
export function nodesToDxf(nodes: readonly VisualNode[], layers: readonly Layer[]): DxfExportResult {
    const drawing = emptyDrawing();
    drawing.insUnits = DXF_UNITS[UnitSetup.settings.baseUnit] ?? DXF_UNITS.unitless;
    drawing.layers = layers.map(toLayerRecord);
    if (drawing.layers.length === 0) {
        drawing.layers.push({
            name: "0",
            color: 0xffffff,
            off: false,
            frozen: false,
            locked: false,
            plot: true,
            lineType: DXF_LINETYPE_CONTINUOUS,
        });
    }

    const layerNames = new Map(layers.map((layer) => [layer.id, layer.name]));
    let skipped = 0;
    let dimensionBlock = 0;

    for (const node of nodes) {
        const style: EntityStyle = {
            layer: layerNames.get(node.layerId) ?? "0",
        };

        const before = drawing.entities.length;
        if (node instanceof TextAnnotation) {
            drawing.entities.push(textEntity(node, style));
        } else if (node instanceof DimensionAnnotation) {
            dimensionBlock += 1;
            appendDimension(drawing, node, style, dimensionBlock);
        } else if (node instanceof ShapeNode) {
            appendShape(drawing, node, style);
        }

        if (drawing.entities.length === before) skipped += 1;
    }

    return { drawing, skipped };
}

function toLayerRecord(layer: Layer): DxfLayerRecord {
    return {
        name: layer.name,
        // A layer that follows the theme has no colour of its own to write; white is what
        // AutoCAD calls colour 7, which is the same "whatever contrasts" convention.
        color: layer.usesThemeColor ? 0xffffff : layer.color,
        off: !layer.visible,
        frozen: layer.frozen,
        locked: layer.locked,
        plot: layer.printable,
        lineType: LINE_TYPE_TO_DXF[layer.lineType] ?? DXF_LINETYPE_CONTINUOUS,
        lineWeight: lineWeightToDxf(layer.lineWeight),
    };
}

const lineTypeOverride = (lineType: LineType | undefined): string | undefined =>
    lineType && lineType !== "byLayer" ? LINE_TYPE_TO_DXF[lineType] : undefined;

/**
 * Writes a node's kernel shape. Wires whose edges are all straight become a single
 * LWPOLYLINE - a rectangle should arrive in AutoCAD as one polyline the user can grip and
 * close, not four unrelated lines - and everything else is written edge by edge.
 */
function appendShape(drawing: DxfDrawing, node: ShapeNode, style: EntityStyle): void {
    const result = node.shape;
    if (!result.isOk) return;

    const shape = result.value.transformedMul(node.worldTransform());
    const entityStyle: EntityStyle = {
        ...style,
        lineType: lineTypeOverride((node as { lineType?: LineType }).lineType),
    };

    const wires = shape.findSubShapes(ShapeTypes.wire) as IWire[];
    const consumed = new Set<string>();
    for (const wire of wires) {
        const polyline = polylineFromWire(wire, entityStyle);
        if (!polyline) continue;
        drawing.entities.push(polyline);
        for (const edge of wire.edgeLoop()) consumed.add(edge.id);
    }

    for (const edge of shape.findSubShapes(ShapeTypes.edge) as IEdge[]) {
        if (consumed.has(edge.id)) continue;
        const entity = edgeEntity(edge, entityStyle);
        if (entity) drawing.entities.push(entity);
    }

    // A bare vertex - a point node - has no edges at all.
    if (shape.shapeType === ShapeTypes.vertex) {
        const vertices = shape.findSubShapes(ShapeTypes.vertex);
        for (const vertex of vertices) {
            const point = (vertex as unknown as { point(): XYZ }).point();
            drawing.entities.push({ type: "point", ...entityStyle, position: vec(point) });
        }
    }
}

/**
 * A polyline for a wire whose edges are all lines and arcs, with each arc carried by the
 * bulge on the vertex it starts at. Returns undefined when the wire holds anything else,
 * in which case the caller falls back to writing its edges individually.
 */
function polylineFromWire(wire: IWire, style: EntityStyle): DxfEntity | undefined {
    const edges = wire.edgeLoop();
    if (edges.length < 2) return undefined;

    const vertices: DxfPolylineVertex[] = [];
    let previousEnd: XYZ | undefined;

    for (const edge of edges) {
        const curve = edge.curve;
        const start = curve.startPoint();
        const end = curve.endPoint();
        // A wire's edges are ordered but not necessarily oriented head to tail.
        const [from, to] =
            previousEnd && previousEnd.distanceTo(start) > previousEnd.distanceTo(end)
                ? [end, start]
                : [start, end];

        const type = basisType(curve);
        if (type === "line") {
            vertices.push({ x: from.x, y: from.y, bulge: 0 });
        } else if (type === "circle") {
            const circle = basis(curve) as ICircle;
            const bulge = bulgeOf(circle, from, to);
            if (bulge === undefined) return undefined;
            vertices.push({ x: from.x, y: from.y, bulge });
        } else {
            return undefined;
        }
        previousEnd = to;
    }

    const first = edges[0].curve.startPoint();
    const closed = previousEnd !== undefined && previousEnd.distanceTo(first) < 1e-7;
    if (!closed && previousEnd) {
        vertices.push({ x: previousEnd.x, y: previousEnd.y, bulge: 0 });
    }

    return {
        type: "polyline",
        ...style,
        vertices,
        closed,
        elevation: first.z,
        normal: dxfVec(0, 0, 1),
    };
}

/**
 * The bulge that carries an arc from `from` to `to` around `circle`: the tangent of a
 * quarter of the included angle, negative when the arc runs clockwise in the XY plane.
 */
function bulgeOf(circle: ICircle, from: XYZ, to: XYZ): number | undefined {
    // Only an arc lying in a plane parallel to XY can be a bulge; anything tilted has to
    // be written as its own entity so its plane survives.
    if (Math.abs(Math.abs(circle.axis.z) - 1) > 1e-7) return undefined;

    const startAngle = Math.atan2(from.y - circle.center.y, from.x - circle.center.x);
    const endAngle = Math.atan2(to.y - circle.center.y, to.x - circle.center.x);
    // The circle's axis says which way its parameterisation runs; a -Z axis is a
    // clockwise arc seen from above.
    const counterClockwise = circle.axis.z > 0;

    let sweep = endAngle - startAngle;
    while (sweep <= 0) sweep += Math.PI * 2;
    if (!counterClockwise) sweep -= Math.PI * 2;

    const bulge = Math.tan(sweep / 4);
    return Number.isFinite(bulge) ? bulge : undefined;
}

/** The underlying curve behind a trimmed one, which is what carries centre/radius/axes. */
const basis = (curve: ITrimmedCurve): ITrimmedCurve | ReturnType<() => unknown> =>
    (curve.basisCurve as ITrimmedCurve) ?? curve;

function basisType(curve: ITrimmedCurve): CurveType {
    const underlying = curve.basisCurve ?? curve;
    return underlying.curveType;
}

function edgeEntity(edge: IEdge, style: EntityStyle): DxfEntity | undefined {
    const curve = edge.curve;
    const start = curve.startPoint();
    const end = curve.endPoint();

    switch (basisType(curve)) {
        case "line":
            return { type: "line", ...style, start: vec(start), end: vec(end) };

        case "circle": {
            const circle = basis(curve) as ICircle;
            const normal = circle.axis;
            const closed = start.distanceTo(end) < 1e-7;
            if (closed) {
                return {
                    type: "circle",
                    ...style,
                    center: vec(circle.center),
                    radius: circle.radius,
                    normal: vec(normal),
                };
            }

            // DXF measures an arc's angles from the +X axis of its own plane and always
            // runs counter-clockwise, so a clockwise kernel arc is written by swapping
            // its ends rather than by storing a negative sweep, which DXF has no room for.
            const counterClockwise = normal.z >= 0;
            const from = counterClockwise ? start : end;
            const to = counterClockwise ? end : start;
            return {
                type: "arc",
                ...style,
                center: vec(circle.center),
                radius: circle.radius,
                startAngle: angleOnCircle(circle, from),
                endAngle: angleOnCircle(circle, to),
                normal: vec(counterClockwise ? normal : normal.reverse()),
            };
        }

        case "ellipse": {
            const ellipse = basis(curve) as IEllipse;
            const major = ellipse.xAxis.normalize()?.multiply(ellipse.majorRadius);
            if (!major) return undefined;
            return {
                type: "ellipse",
                ...style,
                center: vec(ellipse.center),
                majorAxis: vec(major),
                ratio: ellipse.majorRadius === 0 ? 1 : ellipse.minorRadius / ellipse.majorRadius,
                // The kernel parameterises an ellipse by the same eccentric angle DXF
                // stores, so the trim parameters transfer without conversion.
                startParam: curve.firstParameter(),
                endParam: curve.lastParameter(),
                normal: vec(ellipse.axis),
            };
        }

        default:
            return sampledEntity(edge, style);
    }
}

/**
 * Anything the DXF entity set has no match for - a Bezier, a B-spline, an offset curve -
 * written as a polyline through points on the curve. Sampling rather than approximating
 * with a spline keeps the exported shape within a known distance of the real one.
 */
function sampledEntity(edge: IEdge, style: EntityStyle): DxfEntity | undefined {
    const points = edge.curve.uniformAbscissaByCount(SAMPLE_SEGMENTS);
    if (points.length < 2) return undefined;

    return {
        type: "polyline",
        ...style,
        vertices: points.map((p) => ({ x: p.x, y: p.y, bulge: 0 })),
        closed: points[0].distanceTo(points[points.length - 1]) < 1e-7,
        elevation: points[0].z,
        normal: dxfVec(0, 0, 1),
    };
}

function angleOnCircle(circle: ICircle, point: XYZ): number {
    const radial = point.sub(circle.center);
    const x = radial.dot(circle.xAxis);
    const y = radial.dot(circle.yAxis);
    const degrees = Math.atan2(y, x) * RAD_TO_DEG;
    return degrees < 0 ? degrees + 360 : degrees;
}

function textEntity(node: TextAnnotation, style: EntityStyle): DxfEntity {
    return {
        type: "text",
        ...style,
        color: node.color,
        content: node.content,
        position: vec(node.position),
        height: node.height,
        rotation: node.rotation,
        boxWidth: node.boxWidth,
        // Anything that wraps or has more than one line has to be MTEXT: DXF's TEXT is a
        // single line and cannot represent a break at all.
        multiline: node.isMultiline || node.content.includes("\n"),
        attachment: 1,
        normal: vec(node.normal),
    };
}

/**
 * A dimension is written twice over, which is what DXF requires: the DIMENSION entity
 * carries the points that were measured, so the receiving application can re-measure and
 * keep it associative, and an anonymous block carries the drawn picture - lines,
 * arrowheads and the label - so applications that do not rebuild dimensions still show
 * the right thing. `buildDimensionGeometry` already produces exactly that picture for the
 * viewport, so the two cannot drift apart.
 */
function appendDimension(
    drawing: DxfDrawing,
    node: DimensionAnnotation,
    style: EntityStyle,
    index: number,
): void {
    const geometry = node.geometry();
    if (!geometry) return;

    const blockName = `*D${index}`;
    const entities: DxfEntity[] = [];

    for (let i = 0; i + 5 < geometry.lines.length; i += 6) {
        entities.push({
            type: "line",
            layer: style.layer,
            start: dxfVec(geometry.lines[i], geometry.lines[i + 1], geometry.lines[i + 2]),
            end: dxfVec(geometry.lines[i + 3], geometry.lines[i + 4], geometry.lines[i + 5]),
        });
    }

    for (let i = 0; i + 8 < geometry.arrows.length; i += 9) {
        const a = dxfVec(geometry.arrows[i], geometry.arrows[i + 1], geometry.arrows[i + 2]);
        const b = dxfVec(geometry.arrows[i + 3], geometry.arrows[i + 4], geometry.arrows[i + 5]);
        const c = dxfVec(geometry.arrows[i + 6], geometry.arrows[i + 7], geometry.arrows[i + 8]);
        // SOLID's corner order is a bowtie, so the triangle's third corner goes in both of
        // the last two slots rather than the points being listed around the outline.
        entities.push({
            type: "solid",
            layer: style.layer,
            corners: [a, b, c, c],
            normal: dxfVec(0, 0, 1),
        });
    }

    const dimStyle = DimensionSetup.styleFor(node.styleName);
    // DIMSCALE is folded in here as it is everywhere else the style is drawn - the block
    // this writes is exploded line work, so nothing downstream would apply it later.
    const textHeight = dimStyle.textHeight * dimStyle.overallScale;
    entities.push({
        type: "text",
        layer: style.layer,
        content: geometry.text,
        // The block's label is centred on the anchor, which is what group 71 = 5 means.
        position: vec(geometry.textPosition),
        height: textHeight,
        // The label follows the dimension line under DIMTIH/DIMTOH, so the exported text
        // has to turn with it or an aligned dimension would export lying flat.
        rotation: (geometry.textRotation * 180) / Math.PI,
        boxWidth: 0,
        multiline: true,
        attachment: 5,
        normal: dxfVec(0, 0, 1),
    });

    drawing.blocks.push({ name: blockName, basePoint: dxfVec(), entities });

    const measured = dimensionPoints(node);
    drawing.entities.push({
        type: "dimension",
        ...style,
        color: node.color,
        dimensionType: node.dimensionType,
        definitionPoint: measured.definitionPoint,
        textMidPoint: vec(geometry.textPosition),
        point1: measured.point1,
        point2: measured.point2,
        point3: measured.point3,
        point4: measured.point4,
        rotation: measured.rotation,
        // The label is whatever the drawing already shows, so a receiving application that
        // formats differently still prints the value this drawing was dimensioned to.
        text: geometry.text,
        // Always named, even for a dimension that follows the current style: group 3 is
        // a reference into the DIMSTYLE table, and "the style that was current when this
        // was exported" is not something the receiving application can work out later.
        styleName: dimStyle.name,
        normal: vec(node.normal),
        blockName,
    });
}

/** Lays a dimension's stored points into the groups DXF expects for its type. */
function dimensionPoints(node: DimensionAnnotation): {
    definitionPoint: DxfVec;
    point1?: DxfVec;
    point2?: DxfVec;
    point3?: DxfVec;
    point4?: DxfVec;
    rotation: number;
} {
    switch (node.dimensionType) {
        case "radius":
        case "diameter":
            // Group 10 is the centre and 15 the point on the circle.
            return {
                definitionPoint: vec(node.startPoint),
                point1: vec(node.offsetPoint),
                rotation: 0,
            };

        case "angular":
            // 13/14 and 15/16 are the two rays; 10 is where the arc was placed.
            return {
                definitionPoint: vec(node.offsetPoint),
                point1: vec(node.endPoint),
                point2: vec(node.thirdPoint ?? node.endPoint),
                point3: vec(node.startPoint),
                point4: vec(node.startPoint),
                rotation: 0,
            };

        default: {
            const span = node.endPoint.sub(node.startPoint);
            const rotation =
                node.dimensionType === "linear"
                    ? linearRotation(node)
                    : Math.atan2(span.y, span.x) * RAD_TO_DEG;
            return {
                definitionPoint: vec(node.offsetPoint),
                point1: vec(node.startPoint),
                point2: vec(node.endPoint),
                rotation,
            };
        }
    }
}

/**
 * A linear dimension measures along one axis, and which one it picked is implied by where
 * the dimension line was placed - the same rule buildDimensionGeometry uses, so the angle
 * written out matches the measurement shown.
 */
function linearRotation(node: DimensionAnnotation): number {
    const span = node.endPoint.sub(node.startPoint);
    const offset = node.offsetPoint.sub(node.startPoint);
    const xAxis = node.xAxis.normalize() ?? node.xAxis;
    const yAxis = node.normal.cross(xAxis).normalize();
    if (!yAxis) return 0;

    const alongX = Math.abs(span.dot(xAxis));
    const alongY = Math.abs(span.dot(yAxis));
    const offsetX = Math.abs(offset.dot(xAxis));
    const offsetY = Math.abs(offset.dot(yAxis));

    // Placed above or below a span means it is being measured horizontally; placed beside
    // it means vertically.
    const horizontal = MathUtils.almostEqual(alongX, alongY) ? offsetY >= offsetX : alongX >= alongY;
    return horizontal ? 0 : 90;
}

/**
 * A lineweight as DXF group 370 wants it: hundredths of a millimetre, or one of the
 * negative inherited values passed straight through.
 */
const dxfLineWeight = (mm: number) => (mm < 0 ? mm : Math.round(mm * 100));

/** A dimension linetype as a DXF LTYPE name. */
const dxfLineTypeName = (lineType: DimensionLineType): string => {
    if (lineType === "byLayer") return DXF_LINETYPE_BYLAYER;
    if (lineType === "byBlock") return "ByBlock";
    return LINE_TYPE_TO_DXF[lineType] ?? DXF_LINETYPE_CONTINUOUS;
};

/**
 * Every style the DIMSTYLE table should carry, so plots match the screen and a dimension's
 * group 3 has a record to point at. Sizes have DIMSCALE folded in, as they do everywhere
 * else a style is drawn.
 */
export function dimensionStylesForExport() {
    return DimensionSetup.styles.map((settings) => {
        const scale = settings.overallScale;
        return {
            name: settings.name,
            textHeight: settings.textHeight * scale,
            arrowSize: settings.arrowSize * scale,
            extensionOffset: settings.extensionOffset * scale,
            decimals: DimensionSetup.decimalPlaces(settings.precision),
            // DXF carries a lineweight as hundredths of a millimetre, with the inherited
            // values kept as their own negatives - which is the same encoding the model
            // stores, just scaled.
            dimLineWeight: dxfLineWeight(settings.dimLineWeight),
            extLineWeight: dxfLineWeight(settings.extLineWeight),
            // The inherited linetypes have DXF names of their own; the four concrete
            // patterns go through the same acad.lin names the layer table uses, so a
            // dimension and a layer asking for HIDDEN name the same LTYPE record.
            dimLineType: dxfLineTypeName(settings.dimLineType),
            extLineType1: dxfLineTypeName(settings.extLineType1),
            extLineType2: dxfLineTypeName(settings.extLineType2),
        };
    });
}

/** True when a node has geometry or annotation content that DXF can carry. */
export function isExportable(node: VisualNode): boolean {
    return node instanceof ShapeNode || node instanceof TextAnnotation || node instanceof DimensionAnnotation;
}
