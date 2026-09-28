import { CurveUtils, type ICircle, type IEdge, type SnapResult, type XYZ } from "@draftworks/core";

/** What a picked edge tells a dimension command, in world coordinates. */
export interface PickedEdgeGeometry {
    /** Set for a circle or arc. */
    circle?: { center: XYZ; radius: number };
    /** The edge's exact endpoints - the values AutoCAD dimensions an object by. */
    start: XYZ;
    end: XYZ;
}

/**
 * Reads a picked edge's exact geometry, transformed into world space.
 *
 * Memoised per SnapResult because dimension commands call this from their preview,
 * which runs on every pointer move: without the cache each frame built a fresh
 * transformed OCCT edge and leaked it into the command's dispose stack. The picked
 * shape cannot change while the step that produced it is finished, so one read is
 * enough.
 */
const cache = new WeakMap<SnapResult, PickedEdgeGeometry | undefined>();

export function pickedEdgeGeometry(data: SnapResult | undefined): PickedEdgeGeometry | undefined {
    if (!data?.shapes?.length) return undefined;
    if (cache.has(data)) return cache.get(data);

    const result = readEdge(data);
    cache.set(data, result);
    return result;
}

function readEdge(data: SnapResult): PickedEdgeGeometry | undefined {
    const picked = data.shapes[0];
    const edge = picked.shape.transformedMul(picked.transform) as IEdge;
    try {
        const curve = edge.curve;
        // Endpoints come straight off the curve, so the dimension is exactly the
        // object's - no dependence on how precisely the pointer landed on it.
        const geometry: PickedEdgeGeometry = {
            start: curve.startPoint(),
            end: curve.endPoint(),
        };
        // The curve off an edge is trimmed; the circle it was cut from is its basis,
        // so an arc reports the radius of its full circle - which is what a radius or
        // diameter dimension measures. The edge is already transformed above, so the
        // centre and radius read out in world coordinates.
        const basisCurve = curve.basisCurve;
        if (CurveUtils.isCircle(basisCurve)) {
            const circle = basisCurve as ICircle;
            geometry.circle = { center: circle.center, radius: circle.radius };
        }
        return geometry;
    } finally {
        edge.dispose();
    }
}
