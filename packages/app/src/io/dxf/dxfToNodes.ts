// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Turns a parsed `DxfDrawing` into document nodes.
 *
 * Two things here are worth knowing before reading the rest:
 *
 * - **Blocks are flattened.** DraftWorks has no block-reference body, so an INSERT is
 *   resolved to its block's entities with the insert's placement baked in, recursively
 *   and including the row/column array an INSERT can carry. A drawing full of blocks
 *   therefore imports as ordinary geometry rather than as nothing at all.
 * - **Some curves become polylines.** A B-spline has no body in DraftWorks, and neither
 *   does a circle that a non-uniformly scaled INSERT has squashed into an ellipse at an
 *   angle. Both are sampled to a chord tolerance rather than being dropped or faked as
 *   something they are not; `Placement.isSimilarity` is what decides which path a curved
 *   entity takes.
 */

import {
    type Annotation,
    DimensionAnnotation,
    type DimensionType,
    FolderNode,
    type IDocument,
    type IEdge,
    type INode,
    type Layer,
    TextAnnotation,
    XYZ,
} from "@draftworks/core";
import { ArcNode } from "../../bodys/arc";
import { CircleNode } from "../../bodys/circle";
import { EllipseNode } from "../../bodys/ellipse";
import { LineNode } from "../../bodys/line";
import { PointNode } from "../../bodys/point";
import { PolygonNode } from "../../bodys/polygon";
import { WireNode } from "../../bodys/wire";
import { bulgeArc, sampleCount, sampleSpline } from "./dxfGeometry";
import {
    DXF_TO_LINE_TYPE,
    type DxfArcEntity,
    type DxfCircleEntity,
    type DxfDrawing,
    type DxfEllipseEntity,
    type DxfEntity,
    type DxfPolylineEntity,
    type DxfSplineEntity,
    type DxfTextEntity,
    type DxfVec,
    dxfVec,
    ocsToWorld,
} from "./dxfModel";

const DEG = Math.PI / 180;

export interface DxfImportResult {
    /** One folder per imported file, holding everything the drawing contained. */
    node: FolderNode;
    /** Entity types the file used that produced nothing. */
    unsupported: string[];
    /** How many entities produced a node, for the caller to report. */
    imported: number;
}

/**
 * A block reference's placement, as a 3x3 linear map plus a translation. A matrix rather
 * than a scale/rotation pair because nested INSERTs compose, and a scale under one
 * rotation followed by another rotation is not expressible as scale-then-rotate.
 */
class Placement {
    /** Row-major 3x3. */
    constructor(
        readonly m: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1],
        readonly t: DxfVec = dxfVec(),
    ) {}

    static identity(): Placement {
        return new Placement();
    }

    static fromInsert(position: DxfVec, scale: DxfVec, rotationDegrees: number): Placement {
        const a = rotationDegrees * DEG;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        // Scale first, then rotate about Z, which is the order DXF defines for an INSERT.
        return new Placement(
            [cos * scale.x, -sin * scale.y, 0, sin * scale.x, cos * scale.y, 0, 0, 0, scale.z],
            position,
        );
    }

    point(p: DxfVec): DxfVec {
        const { m, t } = this;
        return dxfVec(
            m[0] * p.x + m[1] * p.y + m[2] * p.z + t.x,
            m[3] * p.x + m[4] * p.y + m[5] * p.z + t.y,
            m[6] * p.x + m[7] * p.y + m[8] * p.z + t.z,
        );
    }

    /** A direction: the linear part only, with no translation. */
    vector(p: DxfVec): DxfVec {
        const { m } = this;
        return dxfVec(
            m[0] * p.x + m[1] * p.y + m[2] * p.z,
            m[3] * p.x + m[4] * p.y + m[5] * p.z,
            m[6] * p.x + m[7] * p.y + m[8] * p.z,
        );
    }

    /** This placement applied first, then `outer`. Named away from `then` so the object is not thenable. */
    andThen(outer: Placement): Placement {
        const a = outer.m;
        const b = this.m;
        const m: number[] = [];
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                m.push(a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col]);
            }
        }
        return new Placement(m, outer.point(this.t));
    }

    /**
     * True when the map is a rotation, a uniform scale, a mirror, or a combination -
     * exactly the cases where a circle stays a circle and an arc keeps its radius, so the
     * entity can be transformed exactly instead of being sampled.
     */
    get isSimilarity(): boolean {
        const columns = [
            [this.m[0], this.m[3], this.m[6]],
            [this.m[1], this.m[4], this.m[7]],
            [this.m[2], this.m[5], this.m[8]],
        ];
        const lengths = columns.map((c) => Math.hypot(c[0], c[1], c[2]));
        if (lengths.some((l) => l < 1e-12)) return false;
        if (Math.abs(lengths[0] - lengths[1]) > 1e-9 * lengths[0]) return false;

        const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        return Math.abs(dot(columns[0], columns[1])) < 1e-9 * lengths[0] * lengths[1];
    }

    get scale(): number {
        return Math.hypot(this.m[0], this.m[3], this.m[6]);
    }

    /** Negative when the map turns the drawing over, which reverses every arc direction. */
    get determinant(): number {
        const m = this.m;
        return (
            m[0] * (m[4] * m[8] - m[5] * m[7]) -
            m[1] * (m[3] * m[8] - m[5] * m[6]) +
            m[2] * (m[3] * m[7] - m[4] * m[6])
        );
    }

    /** How much the map turns the X axis by, in degrees: an entity's added rotation. */
    get rotationDegrees(): number {
        return Math.atan2(this.m[3], this.m[0]) / DEG;
    }
}

const toXYZ = (v: DxfVec): XYZ => new XYZ({ x: v.x, y: v.y, z: v.z });

/** Places a point from an entity's own plane into world space, then through the insert. */
const place = (p: DxfVec, normal: DxfVec, placement: Placement): XYZ =>
    toXYZ(placement.point(ocsToWorld(p, normal)));

export function dxfToNodes(document: IDocument, drawing: DxfDrawing, fileName: string): DxfImportResult {
    const layers = resolveLayers(document, drawing);
    const blocks = new Map(drawing.blocks.map((block) => [block.name.toUpperCase(), block]));
    const folder = new FolderNode({ document, name: fileName });
    const unsupported = new Set(drawing.unsupported);

    const nodes: INode[] = [];
    flatten(drawing.entities, blocks, Placement.identity(), 0, (entity, placement) => {
        const built = buildNode(document, entity, placement, unsupported);
        for (const node of built) {
            applyProperties(node, entity, layers, document);
            nodes.push(node);
        }
    });

    if (nodes.length > 0) folder.add(...nodes);
    return { node: folder, unsupported: [...unsupported].sort(), imported: nodes.length };
}

/** Guards against a block that references itself, directly or through another block. */
const MAX_BLOCK_DEPTH = 16;

function flatten(
    entities: readonly DxfEntity[],
    blocks: ReadonlyMap<string, { basePoint: DxfVec; entities: DxfEntity[] }>,
    placement: Placement,
    depth: number,
    emit: (entity: DxfEntity, placement: Placement) => void,
): void {
    for (const entity of entities) {
        if (entity.type !== "insert") {
            emit(entity, placement);
            continue;
        }
        if (depth >= MAX_BLOCK_DEPTH) continue;

        const block = blocks.get(entity.blockName.toUpperCase());
        if (!block) continue;

        // An INSERT can be an array: the same block repeated on a grid, spaced in the
        // block's own rotated frame rather than along the world axes.
        for (let col = 0; col < entity.columns; col++) {
            for (let row = 0; row < entity.rows; row++) {
                const offset = dxfVec(
                    entity.position.x + col * entity.columnSpacing,
                    entity.position.y + row * entity.rowSpacing,
                    entity.position.z,
                );
                const insert = Placement.fromInsert(offset, entity.scale, entity.rotation);
                // The block's base point is the origin the block was drawn around, so it
                // has to come off before the insert's own placement is applied.
                const base = new Placement(
                    [1, 0, 0, 0, 1, 0, 0, 0, 1],
                    dxfVec(-block.basePoint.x, -block.basePoint.y, -block.basePoint.z),
                );
                flatten(block.entities, blocks, base.andThen(insert).andThen(placement), depth + 1, emit);
            }
        }
    }
}

/**
 * Matches the file's layers onto the drawing's, by name and case-insensitively, creating
 * the ones that are missing. Existing layers are left alone: importing a file should not
 * silently recolour the layers the user already has.
 */
function resolveLayers(document: IDocument, drawing: DxfDrawing): Map<string, string> {
    const manager = document.modelManager;
    const byName = new Map<string, string>();
    for (const layer of manager.layers) byName.set(layer.name.toUpperCase(), layer.id);

    for (const record of drawing.layers) {
        const key = record.name.toUpperCase();
        if (byName.has(key)) continue;

        const layer: Layer = manager.addLayer(record.name);
        if (record.color !== undefined) layer.color = record.color;
        layer.visible = !record.off;
        layer.frozen = record.frozen;
        layer.locked = record.locked;
        layer.printable = record.plot;
        layer.lineType = DXF_TO_LINE_TYPE[record.lineType.toUpperCase()] ?? "solid";
        if (record.lineWeight !== undefined) layer.lineWeight = record.lineWeight;
        byName.set(key, layer.id);
    }
    return byName;
}

function applyProperties(
    node: INode,
    entity: DxfEntity,
    layers: ReadonlyMap<string, string>,
    document: IDocument,
): void {
    const layerId = layers.get(entity.layer.toUpperCase());
    const visual = node as INode & { layerId?: string; color?: number };
    visual.layerId = layerId ?? document.modelManager.ensureDefaultLayer().id;
    // Annotations carry their own colour; geometry takes its colour from its layer, so an
    // entity-level override only has somewhere to go on the annotation types.
    if (entity.color !== undefined && node instanceof Object && "annotationType" in node) {
        (node as unknown as Annotation).color = entity.color;
    }
}

function buildNode(
    document: IDocument,
    entity: DxfEntity,
    placement: Placement,
    unsupported: Set<string>,
): INode[] {
    switch (entity.type) {
        case "line":
            return [
                new LineNode({
                    document,
                    start: place(entity.start, { x: 0, y: 0, z: 1 }, placement),
                    end: place(entity.end, { x: 0, y: 0, z: 1 }, placement),
                }),
            ];

        case "circle":
            return buildCircle(document, entity, placement);

        case "arc":
            return buildArc(document, entity, placement);

        case "ellipse":
            return buildEllipse(document, entity, placement);

        case "polyline":
            return buildPolyline(document, entity, placement);

        case "spline":
            return buildSpline(document, entity, placement);

        case "point":
            return [
                new PointNode({
                    document,
                    position: place(entity.position, { x: 0, y: 0, z: 1 }, placement),
                }),
            ];

        case "solid": {
            // A filled quad has no filled body here, so it comes in as its outline. The
            // fourth corner repeats the third on a triangle, which would make a zero
            // length segment, so duplicates are dropped.
            const corners = entity.corners.map((c) => place(c, entity.normal, placement));
            const outline = corners.filter((p, i) => i === 0 || p.sub(corners[i - 1]).length() > 1e-9);
            if (outline.length < 3) return [];
            return [new PolygonNode({ document, points: [...outline, outline[0]] })];
        }

        case "text":
            return [buildText(document, entity, placement)];

        case "dimension":
            return [buildDimension(document, entity, placement)];

        default:
            unsupported.add(String((entity as { type?: string }).type ?? "unknown"));
            return [];
    }
}

function buildCircle(document: IDocument, entity: DxfCircleEntity, placement: Placement): INode[] {
    if (!placement.isSimilarity) {
        return [polygonFrom(document, sampleCircle(entity, placement), true)];
    }
    const center = place(entity.center, entity.normal, placement);
    const normal = placement.vector(entity.normal);
    return [
        new CircleNode({
            document,
            normal: toXYZ(normal),
            center,
            radius: entity.radius * placement.scale,
        }),
    ];
}

function buildArc(document: IDocument, entity: DxfArcEntity, placement: Placement): INode[] {
    if (!placement.isSimilarity) {
        return [polygonFrom(document, sampleArc(entity, placement), false)];
    }

    const sweep = normalizeSweep(entity.endAngle - entity.startAngle);
    const startLocal = dxfVec(
        entity.center.x + entity.radius * Math.cos(entity.startAngle * DEG),
        entity.center.y + entity.radius * Math.sin(entity.startAngle * DEG),
        entity.center.z,
    );

    return [
        new ArcNode({
            document,
            normal: toXYZ(placement.vector(entity.normal)),
            center: place(entity.center, entity.normal, placement),
            start: place(startLocal, entity.normal, placement),
            // A mirrored placement turns the drawing over, which reverses the direction
            // the arc sweeps in; the normal alone does not capture that.
            angle: placement.determinant < 0 ? -sweep : sweep,
        }),
    ];
}

/** DXF arcs always run counter-clockwise from start to end, so the sweep is never negative. */
function normalizeSweep(degrees: number): number {
    const sweep = ((degrees % 360) + 360) % 360;
    // A start angle equal to the end angle means a whole circle, not a zero-length arc.
    return sweep === 0 ? 360 : sweep;
}

function buildEllipse(document: IDocument, entity: DxfEllipseEntity, placement: Placement): INode[] {
    const full = Math.abs(Math.abs(entity.endParam - entity.startParam) - Math.PI * 2) < 1e-9;
    if (!placement.isSimilarity) {
        return [polygonFrom(document, sampleEllipse(entity, placement), full)];
    }

    const center = place(entity.center, entity.normal, placement);
    const major = placement.vector(ocsToWorld(entity.majorAxis, entity.normal));
    const majorRadius = Math.hypot(major.x, major.y, major.z);
    if (majorRadius < 1e-12) return [];

    const normal = toXYZ(placement.vector(entity.normal));
    const xvec = toXYZ(major);
    const minorRadius = majorRadius * entity.ratio;

    if (full) {
        return [new EllipseNode({ document, normal, center, xvec, majorRadius, minorRadius })];
    }

    // A partial ellipse has no parametric body, so it is built as the trimmed edge itself.
    // DXF's start/end parameters are the eccentric angle from the major axis, which is
    // exactly how the kernel parameterises an ellipse, so no conversion is needed.
    const edge = shapeFactory.ellipse(normal, center, xvec, majorRadius, minorRadius);
    if (!edge.isOk) return [];
    const trimmed = edge.value.trim(entity.startParam, entity.endParam);
    return [new WireNode({ document, edges: [trimmed] })];
}

/**
 * A polyline becomes a plain polygon when every segment is straight, and a wire of line
 * and arc edges when any vertex carries a bulge - which is how DXF puts an arc into a
 * polyline, and losing it would straighten every filleted corner in the drawing.
 */
function buildPolyline(document: IDocument, entity: DxfPolylineEntity, placement: Placement): INode[] {
    const vertices = entity.vertices;
    if (vertices.length < 2) return [];

    const hasBulge = vertices.some((v, i) => v.bulge !== 0 && (entity.closed || i < vertices.length - 1));
    const at = (index: number) =>
        place(dxfVec(vertices[index].x, vertices[index].y, entity.elevation), entity.normal, placement);

    if (!hasBulge) {
        const points = vertices.map((_, i) => at(i));
        if (entity.closed) points.push(points[0]);
        return [new PolygonNode({ document, points })];
    }

    if (!placement.isSimilarity) {
        return [polygonFrom(document, samplePolyline(entity, placement), entity.closed)];
    }

    const normal = toXYZ(placement.vector(entity.normal));
    const flipped = placement.determinant < 0;
    const edges: IEdge[] = [];
    const last = entity.closed ? vertices.length : vertices.length - 1;
    for (let i = 0; i < last; i++) {
        const next = (i + 1) % vertices.length;
        const start = at(i);
        const end = at(next);
        if (start.sub(end).length() < 1e-9) continue;

        const bulge = vertices[i].bulge;
        if (bulge === 0) {
            const line = shapeFactory.line(start, end);
            if (line.isOk) edges.push(line.value);
            continue;
        }

        const arc = bulgeArc(vertices[i], vertices[next], bulge);
        if (!arc) continue;
        const center = place(dxfVec(arc.center.x, arc.center.y, entity.elevation), entity.normal, placement);
        const edge = shapeFactory.arc(normal, center, start, flipped ? -arc.sweep : arc.sweep);
        if (edge.isOk) edges.push(edge.value);
    }

    if (edges.length === 0) return [];
    return [new WireNode({ document, edges })];
}

/**
 * A B-spline sampled into a polyline. DraftWorks has no B-spline body and the kernel's
 * factory exposes no B-spline constructor, so the honest options were to drop splines or
 * to evaluate them; this evaluates them properly with De Boor's algorithm and samples to
 * the chord tolerance above, rather than pretending the control polygon is the curve.
 */
function buildSpline(document: IDocument, entity: DxfSplineEntity, placement: Placement): INode[] {
    const points = sampleSpline(entity);
    if (points.length < 2) {
        // A spline with no usable knot vector still has fit points, which are on the curve.
        const fit = entity.fitPoints.map((p) => toXYZ(placement.point(p)));
        return fit.length >= 2 ? [new PolygonNode({ document, points: fit })] : [];
    }
    return [
        polygonFrom(
            document,
            points.map((p) => placement.point(p)),
            entity.closed,
        ),
    ];
}

function polygonFrom(document: IDocument, points: DxfVec[], closed: boolean): INode {
    const xyz = points.map(toXYZ);
    if (closed && xyz.length > 0) xyz.push(xyz[0]);
    return new PolygonNode({ document, points: xyz });
}

function sampleCircle(entity: DxfCircleEntity, placement: Placement): DxfVec[] {
    const count = sampleCount(entity.radius, Math.PI * 2);
    const points: DxfVec[] = [];
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        points.push(
            placement.point(
                ocsToWorld(
                    dxfVec(
                        entity.center.x + entity.radius * Math.cos(a),
                        entity.center.y + entity.radius * Math.sin(a),
                        entity.center.z,
                    ),
                    entity.normal,
                ),
            ),
        );
    }
    return points;
}

function sampleArc(entity: DxfArcEntity, placement: Placement): DxfVec[] {
    const sweep = normalizeSweep(entity.endAngle - entity.startAngle) * DEG;
    const count = sampleCount(entity.radius, sweep);
    const points: DxfVec[] = [];
    for (let i = 0; i <= count; i++) {
        const a = entity.startAngle * DEG + (i / count) * sweep;
        points.push(
            placement.point(
                ocsToWorld(
                    dxfVec(
                        entity.center.x + entity.radius * Math.cos(a),
                        entity.center.y + entity.radius * Math.sin(a),
                        entity.center.z,
                    ),
                    entity.normal,
                ),
            ),
        );
    }
    return points;
}

function sampleEllipse(entity: DxfEllipseEntity, placement: Placement): DxfVec[] {
    const majorRadius = Math.hypot(entity.majorAxis.x, entity.majorAxis.y, entity.majorAxis.z);
    if (majorRadius < 1e-12) return [];
    const ux = entity.majorAxis.x / majorRadius;
    const uy = entity.majorAxis.y / majorRadius;
    const minorRadius = majorRadius * entity.ratio;

    const sweep = entity.endParam - entity.startParam;
    const count = sampleCount(majorRadius, sweep);
    const points: DxfVec[] = [];
    for (let i = 0; i <= count; i++) {
        const t = entity.startParam + (i / count) * sweep;
        const px = majorRadius * Math.cos(t);
        const py = minorRadius * Math.sin(t);
        points.push(
            placement.point(
                ocsToWorld(
                    dxfVec(
                        entity.center.x + px * ux - py * uy,
                        entity.center.y + px * uy + py * ux,
                        entity.center.z,
                    ),
                    entity.normal,
                ),
            ),
        );
    }
    return points;
}

function samplePolyline(entity: DxfPolylineEntity, placement: Placement): DxfVec[] {
    const vertices = entity.vertices;
    const points: DxfVec[] = [];
    const last = entity.closed ? vertices.length : vertices.length - 1;
    const world = (x: number, y: number) =>
        placement.point(ocsToWorld(dxfVec(x, y, entity.elevation), entity.normal));

    for (let i = 0; i < last; i++) {
        const start = vertices[i];
        const end = vertices[(i + 1) % vertices.length];
        points.push(world(start.x, start.y));

        const arc = start.bulge === 0 ? undefined : bulgeArc(start, end, start.bulge);
        if (!arc) continue;

        const from = Math.atan2(start.y - arc.center.y, start.x - arc.center.x);
        const sweep = (arc.sweep * Math.PI) / 180;
        const count = sampleCount(arc.radius, sweep);
        for (let s = 1; s < count; s++) {
            const a = from + (s / count) * sweep;
            points.push(
                world(arc.center.x + arc.radius * Math.cos(a), arc.center.y + arc.radius * Math.sin(a)),
            );
        }
    }
    if (!entity.closed && vertices.length > 0) {
        const end = vertices[vertices.length - 1];
        points.push(world(end.x, end.y));
    }
    return points;
}

function buildText(document: IDocument, entity: DxfTextEntity, placement: Placement): TextAnnotation {
    const normal = placement.vector(entity.normal);
    const scale = placement.isSimilarity ? placement.scale : 1;
    const annotation = new TextAnnotation({
        document,
        annotationType: "text",
        name: entity.content.split("\n")[0].slice(0, 32) || "Text",
        content: entity.content,
        position: place(entity.position, entity.normal, placement),
        height: entity.height * scale,
        rotation: entity.rotation + placement.rotationDegrees,
        boxWidth: entity.multiline ? entity.boxWidth * scale : 0,
        normal: toXYZ(normal),
        xAxis: XYZ.unitX,
    });

    if (entity.multiline && entity.attachment !== 1) {
        annotation.position = shiftToTopLeft(annotation, entity.attachment);
    }
    return annotation;
}

/**
 * MTEXT can hang from any of nine points on its block; TextAnnotation always hangs from
 * the top-left, so the insertion point is moved by however far the file's attachment sits
 * from there.
 */
function shiftToTopLeft(annotation: TextAnnotation, attachment: number): XYZ {
    const { width, height } = annotation.layout();
    const xDir = annotation.rotatedXAxis();
    const yDir = annotation.normal.cross(xDir).normalize();
    if (!yDir) return annotation.position;

    // 1-3 top, 4-6 middle, 7-9 bottom; 1/4/7 left, 2/5/8 centre, 3/6/9 right.
    const column = (attachment - 1) % 3;
    const row = Math.floor((attachment - 1) / 3);
    const dx = -(column / 2) * width;
    const dy = (row / 2) * height;
    return annotation.position.add(xDir.multiply(dx)).add(yDir.multiply(dy));
}

const DXF_TO_DIMENSION_TYPE: Record<string, DimensionType> = {
    linear: "linear",
    aligned: "aligned",
    angular: "angular",
    radius: "radius",
    diameter: "diameter",
};

/**
 * DXF stores what was measured (groups 13/14/15/16) separately from where the dimension
 * line was dragged to (group 10), which is the same split DimensionAnnotation makes, so
 * the two map across directly rather than through the drawn picture.
 */
function buildDimension(
    document: IDocument,
    entity: DxfEntity & { type: "dimension" },
    placement: Placement,
): DimensionAnnotation {
    const p = (v: DxfVec | undefined) =>
        v ? place(v, entity.normal, placement) : place(entity.definitionPoint, entity.normal, placement);
    const type = DXF_TO_DIMENSION_TYPE[entity.dimensionType] ?? "linear";

    const isRadial = type === "radius" || type === "diameter";
    // Radius and diameter store the centre in group 10 and the point on the circle in 15.
    const start = isRadial ? p(entity.definitionPoint) : p(entity.point1);
    const end = isRadial ? p(entity.point1) : p(entity.point2);
    const radius = isRadial ? end.sub(start).length() : 0;

    return new DimensionAnnotation({
        document,
        annotationType: "dimension",
        dimensionType: type,
        name: "Dimension",
        startPoint: type === "angular" ? p(entity.point4) : start,
        endPoint: type === "angular" ? p(entity.point1) : end,
        thirdPoint: type === "angular" ? p(entity.point2) : undefined,
        offsetPoint: isRadial ? p(entity.textMidPoint) : p(entity.definitionPoint),
        radius,
        normal: toXYZ(placement.vector(entity.normal)),
        xAxis: XYZ.unitX,
        // Kept even when this drawing has no such style: `DimensionSetup.styleFor` draws
        // it in the current style meanwhile, and the name is still right if the file's
        // DIMSTYLE table is imported later or the user recreates the style by hand.
        styleName: entity.styleName,
    });
}
