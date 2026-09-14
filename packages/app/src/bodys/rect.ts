import {
    FacebaseNode,
    type GeometryFact,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IShape,
    type IWire,
    type Plane,
    Precision,
    property,
    Result,
    serializable,
    serialize,
    type XYZ,
} from "@draftworks/core";

export interface RectOptions {
    document: IDocument;
    plane: Plane;
    dx: number;
    dy: number;
    cornerRadius?: number;
    chamferDistance?: number;
}

/** One corner of a treated rectangle, and the side that runs into it. */
export interface RectCorner {
    /** Where the previous corner's treatment ended - the straight side starts here. */
    sideStart: XYZ;
    /** Where this corner's treatment meets the incoming side. */
    from: XYZ;
    /** Where it leaves again, onto the outgoing side. */
    to: XYZ;
    /** The fillet arc's centre. Unused by a chamfer, which runs straight from/to. */
    center: XYZ;
}

/**
 * Where every piece of a filleted or chamfered rectangle goes.
 *
 * Kept as a free function over plain points, with no kernel calls, because this is the
 * part that is easy to get subtly wrong - a corner centre one setback out, or arcs
 * bending the wrong way on a rectangle dragged up and to the left - and a wrong answer
 * here shows up as a shape that looks nearly right. Exported for testing.
 *
 * Corners come back in drawing order, each paired with the side leading into it, so a
 * caller can emit side/treatment/side/treatment round the loop and close it.
 */
export function rectCorners(
    plane: Plane,
    dx: number,
    dy: number,
    setback: number,
): { corners: RectCorner[]; winding: number } {
    const points = RectNode.points(plane, dx, dy).slice(0, 4);

    const corners = points.map((corner, i) => {
        const previous = points[(i + 3) % 4];
        const next = points[(i + 1) % 4];

        // Along each side, back from the corner by the setback.
        const from = corner.add(previous.sub(corner).normalize()!.multiply(setback));
        const to = corner.add(next.sub(corner).normalize()!.multiply(setback));

        return {
            sideStart: previous.add(corner.sub(previous).normalize()!.multiply(setback)),
            from,
            to,
            // The two tangent points are each one setback from the corner along
            // perpendicular sides, so stepping from one of them by the other's offset
            // lands on the arc centre - the fourth point of that little square.
            center: from.add(to.sub(corner)),
        };
    });

    // A rectangle dragged down-left traverses its corners the other way round, and its
    // fillet arcs have to bend with it rather than bulging out of the shape.
    return { corners, winding: Math.sign(dx * dy) || 1 };
}

/**
 * The distance round a rectangle whose corners have been treated.
 *
 * Each corner gives up `setback` from both of the sides meeting there - 8 setbacks in
 * all - and gets back whatever the treatment itself measures: a quarter-circle arc for a
 * fillet, or the straight hypotenuse for a chamfer. Exported for testing.
 */
export function rectPerimeter(dx: number, dy: number, setback: number, rounded: boolean): number {
    const square = 2 * (dx + dy);
    if (setback <= 0) return square;

    const cut = rounded ? (Math.PI * setback) / 2 : Math.SQRT2 * setback;
    return square - 8 * setback + 4 * cut;
}

/**
 * The ground a rectangle covers once its corners are treated.
 *
 * Each corner loses the little `setback` square it sat in, less whatever the treatment
 * puts back - a quarter disc for a fillet, half the square for a chamfer's triangle.
 * Exported for testing.
 */
export function rectArea(dx: number, dy: number, setback: number, rounded: boolean): number {
    const square = dx * dy;
    if (setback <= 0) return square;

    const corner = setback * setback;
    const kept = rounded ? (Math.PI * corner) / 4 : corner / 2;
    return square - 4 * (corner - kept);
}

// 2D-compatible - planar, face-optional via FacebaseNode.isFace (see circle.ts for
// the fuller rationale).
@serializable()
export class RectNode extends FacebaseNode {
    override display(): I18nKeys {
        return "body.rect";
    }

    @serialize()
    @property("rect.dx", { type: "length" })
    get dx() {
        return this.getPrivateValue("dx");
    }
    set dx(dx: number) {
        this.setPropertyEmitShapeChanged("dx", dx);
    }

    @serialize()
    @property("rect.dy", { type: "length" })
    get dy() {
        return this.getPrivateValue("dy");
    }
    set dy(dy: number) {
        this.setPropertyEmitShapeChanged("dy", dy);
    }

    /**
     * RECTANG's Fillet: the radius of the arc at each corner. Zero is a sharp corner.
     *
     * Mutually exclusive with `chamferDistance`, the way AutoCAD's own options are - a
     * corner is rounded or cut off, not both - so setting one clears the other rather
     * than leaving the shape to decide which of two answers it believes.
     */
    @serialize()
    @property("rect.cornerRadius", { type: "length" })
    get cornerRadius() {
        return this.getPrivateValue("cornerRadius", 0);
    }
    set cornerRadius(value: number) {
        const radius = Math.max(0, value);
        if (radius > 0 && this.chamferDistance > 0) {
            this.setPrivateValue("chamferDistance", 0);
        }
        this.setPropertyEmitShapeChanged("cornerRadius", radius);
    }

    /** RECTANG's Chamfer, as the equal setback cut from both sides of each corner. */
    @serialize()
    @property("rect.chamferDistance", { type: "length" })
    get chamferDistance() {
        return this.getPrivateValue("chamferDistance", 0);
    }
    set chamferDistance(value: number) {
        const distance = Math.max(0, value);
        if (distance > 0 && this.cornerRadius > 0) {
            this.setPrivateValue("cornerRadius", 0);
        }
        this.setPropertyEmitShapeChanged("chamferDistance", distance);
    }

    @serialize()
    get plane(): Plane {
        return this.getPrivateValue("plane");
    }
    set plane(value: Plane) {
        this.setPropertyEmitShapeChanged("plane", value);
    }

    constructor(options: RectOptions) {
        super({ document: options.document });
        this.setPrivateValue("plane", options.plane);
        this.setPrivateValue("dx", options.dx);
        this.setPrivateValue("dy", options.dy);
        this.setPrivateValue("cornerRadius", Math.max(0, options.cornerRadius ?? 0));
        this.setPrivateValue(
            "chamferDistance",
            options.cornerRadius ? 0 : Math.max(0, options.chamferDistance ?? 0),
        );
    }

    // What AutoCAD reports for the closed polyline a RECTANG draws: the distance round
    // it and the ground it covers, whether or not it is filled.
    override geometryFacts(): GeometryFact[] {
        const scale = this.worldTransform().getScale();
        const dx = Math.abs(this.dx * scale.x);
        const dy = Math.abs(this.dy * scale.y);
        // Scaled the same way the sides are, so a treated corner keeps its proportions
        // in the measurement as well as in the shape.
        const setback = this.cornerSetback() * Math.min(Math.abs(scale.x), Math.abs(scale.y));

        return [
            {
                display: "geometry.perimeter",
                value: rectPerimeter(dx, dy, setback, this.cornerRadius > 0),
                kind: "length",
            },
            {
                display: "common.area",
                value: rectArea(dx, dy, setback, this.cornerRadius > 0),
                kind: "area",
            },
        ];
    }

    /**
     * How much each corner is cut back, clamped to what the rectangle can actually give.
     *
     * Two adjacent corners eat into the same side, so anything past half the shorter side
     * would run them into each other and produce a wire that crosses itself. AutoCAD
     * clamps instead of refusing, and so does this: the rectangle keeps its size and the
     * corners come out as large as they can be.
     */
    private cornerSetback(): number {
        const requested = this.cornerRadius > 0 ? this.cornerRadius : this.chamferDistance;
        if (requested <= 0) return 0;
        return Math.min(requested, Math.abs(this.dx) / 2, Math.abs(this.dy) / 2);
    }

    generateShape(): Result<IShape, string> {
        const setback = this.cornerSetback();
        const wire =
            setback > 0
                ? this.treatedWire(setback)
                : shapeFactory.polygon(RectNode.points(this.plane, this.dx, this.dy));
        if (!wire.isOk || !this.isFace) return wire;
        return wire.value.toFace();
    }

    /**
     * The outline with its four corners treated - an arc each for a fillet, a straight
     * cut each for a chamfer. rectCorners works out where every piece goes; this only
     * asks the kernel for the edges and threads them into a wire.
     */
    private treatedWire(setback: number): Result<IWire, string> {
        const plan = rectCorners(this.plane, this.dx, this.dy, setback);
        const arcNormal = this.plane.xvec.cross(this.plane.yvec).normalize()!.multiply(plan.winding);
        const rounded = this.cornerRadius > 0;

        const edges: IEdge[] = [];
        for (const corner of plan.corners) {
            // At the largest setback a rectangle allows, two corners meet in the middle
            // of the shorter side and the straight between them has no length left - a
            // fully rounded rectangle is a stadium, with only arcs down its ends. The
            // kernel refuses a zero-length line, so that side is simply not asked for.
            if (corner.sideStart.distanceTo(corner.from) > Precision.Distance) {
                const side = shapeFactory.line(corner.sideStart, corner.from);
                if (!side.isOk) return Result.err(side.error);
                edges.push(side.value);
            }

            const cut = rounded
                ? shapeFactory.arc(arcNormal, corner.center, corner.from, 90)
                : shapeFactory.line(corner.from, corner.to);
            if (!cut.isOk) return Result.err(cut.error);
            edges.push(cut.value);
        }

        return shapeFactory.wire(edges);
    }

    static points(plane: Plane, dx: number, dy: number): XYZ[] {
        const start = plane.origin;
        return [
            start,
            start.add(plane.xvec.multiply(dx)),
            start.add(plane.xvec.multiply(dx)).add(plane.yvec.multiply(dy)),
            start.add(plane.yvec.multiply(dy)),
            start,
        ];
    }
}
