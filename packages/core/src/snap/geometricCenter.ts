import { Precision } from "../foundation";
import type { Plane, XYZ } from "../math";

/**
 * AutoCAD's Geometric Center (GCEN) snap, as pure geometry.
 *
 * CEN gives you the centre of a circle or arc, which the curve itself defines. A
 * rectangle or a polyline has no such point - what a draftsman means by "the middle
 * of that shape" is its centroid, the balance point of the area it encloses. That is
 * what this computes, so hovering any edge of a rectangle offers its middle as a
 * snap the way hovering a circle offers its centre.
 *
 * Deliberately kept away from shapes, views and the snapping machinery so the
 * formula can be tested on its own - see geometricCenter.test.ts.
 */

/**
 * The area centroid of a closed planar outline, by the shoelace formula, measured in
 * `plane` and returned in world coordinates. `boundary` is the outline's points in
 * order around the loop; the closing segment back to the first point is implied, so
 * repeating it is allowed but not required.
 *
 * Returns undefined for fewer than three points. An outline that encloses no area -
 * every point collinear, or a shape doubled back on itself - has no centroid to
 * speak of, so it falls back to the average of the points, which is still the middle
 * a user would point at and keeps the snap from vanishing on degenerate geometry.
 */
export function polygonCentroid(boundary: XYZ[], plane: Plane): XYZ | undefined {
    const points = dropRepeatedClose(boundary);
    if (points.length < 3) return undefined;

    const flat = points.map((point) => {
        const vector = point.sub(plane.origin);
        return { x: vector.dot(plane.xvec), y: vector.dot(plane.yvec) };
    });

    let twiceArea = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < flat.length; i++) {
        const a = flat[i];
        const b = flat[(i + 1) % flat.length];
        const cross = a.x * b.y - b.x * a.y;
        twiceArea += cross;
        x += (a.x + b.x) * cross;
        y += (a.y + b.y) * cross;
    }

    if (Math.abs(twiceArea) < Precision.Distance) {
        return averageOf(points);
    }

    const scale = 1 / (3 * twiceArea);
    return plane.origin.add(plane.xvec.multiply(x * scale)).add(plane.yvec.multiply(y * scale));
}

/** The plain average of the points - the fallback for an outline with no area. */
function averageOf(points: XYZ[]): XYZ {
    let sum = points[0];
    for (let i = 1; i < points.length; i++) {
        sum = sum.add(points[i]);
    }
    return sum.multiply(1 / points.length);
}

/**
 * A boundary that ends where it began would count its first point twice and skew the
 * result, so the repeat is dropped. Callers walking a closed wire naturally produce
 * one; callers listing corners naturally do not.
 */
function dropRepeatedClose(boundary: XYZ[]): XYZ[] {
    if (boundary.length < 2) return boundary;

    const first = boundary[0];
    const last = boundary[boundary.length - 1];
    return first.distanceTo(last) <= Precision.Distance ? boundary.slice(0, -1) : boundary;
}
