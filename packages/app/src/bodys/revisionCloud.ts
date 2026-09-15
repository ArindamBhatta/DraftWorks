import {
    FacebaseNode,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IShape,
    property,
    Result,
    serializable,
    serialize,
    type XYZ,
} from "@draftworks/core";

export interface RevisionCloudOptions {
    document: IDocument;
    /**
     * The path the arcs are hung off, in order. A closed cloud repeats its first point as
     * its last, the way PolygonNode's points do.
     */
    points: XYZ[];
    normal: XYZ;
    arcLength: number;
}

/**
 * A chain of arc bulges run along a path - AutoCAD's REVCLOUD, the mark-up shape used to
 * ring a part of a drawing that has changed.
 *
 * The path is stored rather than the arcs, because the arcs are derived: `arcLength` is a
 * *nominal* size, and each straight run of the path divides into whole arcs near that
 * size rather than a whole number of them plus a stub. That is AutoCAD's behaviour too,
 * and it is why editing the property re-scallops the whole cloud instead of leaving a
 * short arc wherever the last one landed.
 *
 * 2D-compatible - a closed wire of circular arcs, always compatible with a 2D drafting
 * build. Unlike PolygonNode it is a FacebaseNode that stays a wire in practice: a cloud
 * is a mark-up annotation and filling it would hide the drawing it is drawn around, but
 * isFace is inherited so it can still be converted deliberately (see converter.ts).
 */
@serializable()
export class RevisionCloudNode extends FacebaseNode {
    override display(): I18nKeys {
        return "body.revisionCloud";
    }

    @serialize()
    @property("polygon.points")
    get points(): XYZ[] {
        return this.getPrivateValue("points");
    }
    set points(value: XYZ[]) {
        this.setPropertyEmitShapeChanged("points", value);
    }

    @serialize()
    @property("revisionCloud.arcLength", { type: "length" })
    get arcLength(): number {
        return this.getPrivateValue("arcLength");
    }
    set arcLength(value: number) {
        this.setPropertyEmitShapeChanged("arcLength", Math.max(value, MinArcLength));
    }

    @serialize()
    get normal(): XYZ {
        return this.getPrivateValue("normal");
    }

    constructor(options: RevisionCloudOptions) {
        super({ document: options.document });
        this.setPrivateValue("points", options.points);
        this.setPrivateValue("normal", options.normal);
        this.setPrivateValue("arcLength", Math.max(options.arcLength, MinArcLength));
    }

    generateShape(): Result<IShape, string> {
        const world = this.worldTransform();
        const edges = cloudArcs(
            this.points.map((p) => world.ofPoint(p)),
            world.ofVector(this.normal),
            this.arcLength,
        );
        if (!edges.isOk) return Result.err(edges.error);

        const wire = shapeFactory.wire(edges.value);
        if (!wire.isOk || !this.isFace) return wire;
        return wire.value.toFace();
    }
}

/**
 * Small enough that a cloud drawn at any sane scale still scallops, large enough that a
 * zero or a stray negative cannot ask the kernel for an unbounded number of arcs.
 */
const MinArcLength = 0.1;

/** One scallop, as the arguments shapeFactory.arc is called with. */
export interface CloudArcSpan {
    center: XYZ;
    start: XYZ;
    /** Swept angle in degrees, counter-clockwise about the cloud's normal. */
    angle: number;
}

/**
 * The arcs of a cloud along `points`, each bulging to the left of its chord.
 *
 * "Left" is with respect to `normal`, so which side the scallops land on follows the
 * direction the path was drawn - clockwise and counter-clockwise give a cloud that bulges
 * out and one that bulges in. REVCLOUD has the same property, and its Reverse option is
 * what it offers instead of guessing; here the command reverses the path rather than
 * flipping a sign, so the stored points always read in the drawn order.
 */
export function cloudArcs(points: XYZ[], normal: XYZ, arcLength: number): Result<IEdge[], string> {
    const spans = cloudArcSpans(points, normal, arcLength);
    if (!spans.isOk) return Result.err(spans.error);

    const unitNormal = normal.normalize()!;
    const edges: IEdge[] = [];
    for (const { center, start, angle } of spans.value) {
        const arc = shapeFactory.arc(unitNormal, center, start, angle);
        if (!arc.isOk) return Result.err(arc.error);
        edges.push(arc.value as IEdge);
    }
    return Result.ok(edges);
}

/**
 * Where each scallop of the cloud goes - the whole of the shape's geometry, worked out
 * without touching the kernel so it can be tested directly. Exported for that reason.
 */
export function cloudArcSpans(points: XYZ[], normal: XYZ, arcLength: number): Result<CloudArcSpan[], string> {
    const unitNormal = normal.normalize();
    if (!unitNormal) return Result.err("Revision cloud needs a plane normal");
    if (points.length < 2) return Result.err("Revision cloud needs at least two points");

    const size = Math.max(arcLength, MinArcLength);
    const spans: CloudArcSpan[] = [];

    for (let i = 0; i < points.length - 1; i++) {
        const from = points[i];
        const to = points[i + 1];
        const span = to.sub(from);
        const length = span.length();
        // A repeated pick contributes no segment rather than an arc of nothing.
        if (length < MinArcLength) continue;

        // Whole arcs of near-nominal size, never a stub: a 100-long run at a nominal 30
        // becomes three arcs of 33.3, not three of 30 and one of 10.
        const count = Math.max(1, Math.round(length / size));
        const step = span.multiply(1 / count);

        for (let n = 0; n < count; n++) {
            const start = from.add(step.multiply(n));
            const arc = bulge(start, start.add(step), unitNormal);
            if (!arc.isOk) return Result.err(arc.error);
            spans.push(arc.value);
        }
    }

    if (spans.length === 0) return Result.err("Revision cloud path is too short to draw");
    return Result.ok(spans);
}

/**
 * One scallop: the arc from `start` to `end` that bulges left of the chord.
 *
 * The bulge is a fixed fraction of the chord rather than a fixed radius, so every arc in
 * a cloud has the same shape whatever its length - it is what keeps a cloud looking even
 * after a long run and a short one divide into differently sized arcs.
 */
function bulge(start: XYZ, end: XYZ, normal: XYZ): Result<CloudArcSpan, string> {
    const chord = end.sub(start);
    const half = chord.length() / 2;
    const direction = chord.normalize();
    if (!direction || half === 0) return Result.err("Revision cloud arc has no length");

    // sagitta/half-chord = tan(quarter angle). 0.42 puts the included angle near 92
    // degrees - a touch over a quarter circle, which is the roundness REVCLOUD draws and
    // shallow enough that consecutive arcs meet in a visible cusp rather than a ripple.
    const sagitta = half * 0.42;
    const radius = (half * half + sagitta * sagitta) / (2 * sagitta);

    // Left of the chord, in the plane the cloud is drawn on.
    const outward = normal.cross(direction).normalize();
    if (!outward) return Result.err("Revision cloud arc is parallel to its plane normal");

    // The centre sits on the far side of the chord from the bulge, so the sweep that
    // carries `start` over the bulge and onto `end` turns *clockwise* about `normal` -
    // hence the negative angle. Getting this sign wrong does not draw a mirrored
    // scallop, it lands the arc somewhere else entirely and the edges no longer meet,
    // which surfaces as "Failed to create wire" rather than as a wrong-looking cloud.
    return Result.ok({
        center: start.add(chord.multiply(0.5)).add(outward.multiply(sagitta - radius)),
        start,
        angle: (-4 * Math.atan(sagitta / half) * 180) / Math.PI,
    });
}
