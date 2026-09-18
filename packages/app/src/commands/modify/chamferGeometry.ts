import { MathUtils, Precision, type XYZ } from "@draftworks/core";

/**
 * The chamfer geometry AutoCAD's Distance and Angle methods describe, as the two
 * setbacks from the corner.
 *
 * The kernel's chamferEdge2d takes one distance and steps back by it along both lines,
 * which covers only the equal-distance case. Everything AutoCAD offers beyond that is
 * still just a pair of setbacks along two straight lines, and that is plane
 * trigonometry - so it is worked out here rather than in the WASM, and the existing
 * corner maths does the cutting.
 *
 * Kept free of shapes and documents so the trigonometry can be tested on its own.
 */

/** How the chamfer is specified - AutoCAD's mEthod. */
export type ChamferMethod = "distance" | "angle";

/** The two setbacks from the corner, along the first and second line. */
export interface ChamferSetbacks {
    first: number;
    second: number;
}

/**
 * The setbacks for the Angle method: a length along the first line and the angle the
 * chamfer makes with it.
 *
 * The chamfer, the first line and the second close a triangle. The setback along the
 * first line is given; the angle at the corner is the angle between the lines, and the
 * chamfer leaves the first line at `angle`, so the third angle follows and the sine
 * rule gives the remaining side.
 *
 * Undefined when the triangle does not close: the two angles have to leave something
 * over, or the chamfer never meets the second line.
 */
export function angleMethodSetbacks(
    distance: number,
    angle: number,
    cornerAngle: number,
): ChamferSetbacks | undefined {
    if (!(distance > 0)) return undefined;

    const at = MathUtils.degToRad(angle);
    const corner = MathUtils.degToRad(cornerAngle);
    // The angle the chamfer makes with the second line, by the angle sum of the triangle.
    const third = Math.PI - corner - at;
    if (at <= Precision.Float || third <= Precision.Float) return undefined;

    // Sine rule: the side opposite `at` is to sin(at) as the given side is to sin(third).
    const second = (distance * Math.sin(at)) / Math.sin(third);
    if (!Number.isFinite(second) || second <= 0) return undefined;

    return { first: distance, second };
}

/**
 * The angle between two directions, in degrees, always the one inside the corner - so a
 * corner and the same corner approached from the other side read alike.
 */
export function cornerAngleBetween(direction1: XYZ, direction2: XYZ): number {
    const cosine = MathUtils.clamp(direction1.normalize()!.dot(direction2.normalize()!), -1, 1);
    return MathUtils.radToDeg(Math.acos(cosine));
}

/**
 * Where the two cut points fall, as parameters on each line.
 *
 * `corner1`/`corner2` are the corner's own parameter on each line, and each cut steps
 * back from it towards the side the edge actually occupies - which `toward` names, as
 * the parameter of a point known to be on that side (the edge's midpoint). Stepping the
 * other way would chamfer the empty extension rather than the line.
 */
export function chamferCuts(
    corner1: number,
    toward1: number,
    corner2: number,
    toward2: number,
    setbacks: ChamferSetbacks,
): { cut1: number; cut2: number } {
    return {
        cut1: corner1 + (toward1 > corner1 ? setbacks.first : -setbacks.first),
        cut2: corner2 + (toward2 > corner2 ? setbacks.second : -setbacks.second),
    };
}
