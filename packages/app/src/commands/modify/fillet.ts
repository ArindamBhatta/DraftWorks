import {
    CurveUtils,
    command,
    I18n,
    type ICurve,
    type IEdge,
    type IFace,
    type IShape,
    type ITrimmedCurve,
    Precision,
    property,
    Result,
    type XYZ,
} from "@draftworks/core";
import { EdgeCornerCommand } from "./edgeCornerCommand";

/**
 * The unbounded curve an edge lies on, with every trim taken off.
 *
 * An edge hands its geometry over already wrapped in a trimmed curve, and the wrapping
 * nests when the edge was built from a curve that had been trimmed before - Break does
 * that. A sharp corner has to run past the edge's own ends to reach the crossing, so it
 * needs the curve underneath the trimming; the parameters an edge reports still mean the
 * same thing there, because a trim narrows a curve's range without renumbering it.
 *
 * Only trimmed curves are unwrapped. An offset curve also has a basis, but its basis runs
 * somewhere else entirely, so reaching through one would answer with the wrong line.
 *
 * Exported for testing.
 */
export function supportCurve(curve: ICurve): ICurve {
    let current = curve;
    // Bounded rather than `while`, so a basisCurve that ever pointed at itself would give
    // a wrong answer instead of hanging the command.
    for (let depth = 0; depth < 8 && current.curveType === "trimmedCurve"; depth++) {
        current = (current as ITrimmedCurve).basisCurve;
    }
    return current;
}

/**
 * Where two straight lines cross, as a parameter on each of them - or undefined when they
 * have no one crossing, which for two lines means they are parallel or do not share a
 * plane.
 *
 * Each line is given as a point on it and its unit direction, which is how a line curve
 * describes itself, and that makes the answers parameters on those curves directly: on a
 * line the parameter is the signed distance from its own origin.
 *
 * Exported for testing.
 */
export function crossingParameters(
    origin1: XYZ,
    direction1: XYZ,
    origin2: XYZ,
    direction2: XYZ,
): { param1: number; param2: number } | undefined {
    const normal = direction1.cross(direction2);
    const sine = normal.length();
    // Both directions are unit, so this is the sine of the angle between them. The test is
    // for parallel and nothing more: two lines that all but graze each other do cross, a
    // long way off, and refusing that would be refusing geometry the arc fillet accepts.
    if (sine < Precision.Float) return undefined;

    const between = origin2.sub(origin1);
    // The distance between the two lines, measured along their common normal. Anything
    // above nothing means they pass each other in space rather than meeting.
    if (Math.abs(between.dot(normal) / sine) > Precision.Distance) return undefined;

    // between = param1 * direction1 - param2 * direction2, solved by crossing each side
    // with the other direction and projecting onto the normal.
    const denominator = sine * sine;
    return {
        param1: between.cross(direction2).dot(normal) / denominator,
        param2: between.cross(direction1).dot(normal) / denominator,
    };
}

/**
 * The stretch of its own line an edge becomes once it runs to `corner`: from the corner
 * out to whichever of the edge's ends is farther from it.
 *
 * One rule covers trimming and extending both, which is what lets a sharp corner be one
 * operation rather than two. A corner that falls inside the edge cuts it and the longer
 * side is kept - the same side an arc fillet keeps - and a corner past an end pulls that
 * end out to meet it.
 *
 * Exported for testing.
 */
export function cornerSpan(first: number, last: number, corner: number): { start: number; end: number } {
    const farEnd = corner - first >= last - corner ? first : last;
    return { start: Math.min(corner, farEnd), end: Math.max(corner, farEnd) };
}

/**
 * Runs two straight edges out to where their lines cross and leaves them there, with
 * nothing between them - AutoCAD's FILLET at radius 0.
 *
 * The pair comes back where an arc fillet's three edges would: the corner is the point the
 * two now share, so there is no third edge to put between them.
 */
function sharpCorner(edge1: IEdge, edge2: IEdge): Result<IEdge[]> {
    const line1 = supportCurve(edge1.curve);
    const line2 = supportCurve(edge2.curve);
    if (!CurveUtils.isLine(line1) || !CurveUtils.isLine(line2)) {
        return Result.err(I18n.translate("error.fillet.zeroRadiusNeedsLines"));
    }

    // A line curve's origin is the point at parameter 0, which is the one point on it
    // every kind of curve can be asked for.
    const crossing = crossingParameters(line1.value(0), line1.direction, line2.value(0), line2.direction);
    if (crossing === undefined) {
        return Result.err(I18n.translate("error.fillet.noCorner"));
    }

    return Result.ok([
        edgeToCorner(line1, edge1.curve, crossing.param1),
        edgeToCorner(line2, edge2.curve, crossing.param2),
    ]);
}

/** The edge `span` becomes when its far end is carried to `corner` along `line`. */
function edgeToCorner(line: ICurve, span: ITrimmedCurve, corner: number): IEdge {
    const range = cornerSpan(span.firstParameter(), span.lastParameter(), corner);
    const trimmed = line.trim(range.start, range.end);
    const edge = shapeFactory.edge(trimmed);
    trimmed.dispose();
    return edge;
}

@command({
    key: "modify.fillet",
    icon: "icon-fillet",
})
export class FilletCommand extends EdgeCornerCommand {
    @property("circle.radius")
    get radius() {
        return this.getPrivateValue("radius", 10);
    }

    set radius(value: number) {
        this.setProperty("radius", value);
    }

    /**
     * Whether this run is making a sharp corner rather than a rounded one.
     *
     * A radius of zero is not a fillet too small to build: in AutoCAD it is what you type
     * when the corner should have no curvature at all, and FILLET is used for closing a
     * corner that was drawn open at least as often as for rounding one. A negative radius
     * is still nonsense and is left to the kernel to refuse.
     */
    private get isSharpCorner() {
        return Math.abs(this.radius) < Precision.Distance;
    }

    protected override applyToBody(shape: IShape, edgeIndexes: number[]): Result<IShape> {
        if (this.isSharpCorner) {
            return Result.err(I18n.translate("error.fillet.zeroRadiusOnSolid"));
        }
        return shapeFactory.fillet(shape, edgeIndexes, this.radius);
    }

    protected override applyToFace(face: IFace, edge1: IEdge, edge2: IEdge): Result<IShape> {
        // Two edges of a face meet at a vertex they already share, so the corner a zero
        // radius would make is the corner that is there.
        if (this.isSharpCorner) {
            return Result.err(I18n.translate("error.fillet.cornerAlreadySharp"));
        }
        return shapeFactory.fillet2d(face, edge1, edge2, this.radius);
    }

    protected override applyToEdgePair(edge1: IEdge, edge2: IEdge): Result<IEdge[]> {
        if (this.isSharpCorner) {
            return sharpCorner(edge1, edge2);
        }
        return shapeFactory.filletEdge2d(edge1, edge2, this.radius);
    }
}
