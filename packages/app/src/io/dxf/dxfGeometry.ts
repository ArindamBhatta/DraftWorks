/**
 * The geometry DXF needs that is not geometry the kernel provides: resolving a polyline
 * bulge into an arc, and evaluating a B-spline.
 *
 * Kept apart from `dxfToNodes` so it carries no document or kernel imports - this is the
 * part with real maths in it, and it should be testable on its own.
 */

import { type DxfSplineEntity, type DxfVec, dxfVec } from "./dxfModel";

/** Chord tolerance for curves that have to be sampled, as a fraction of the radius. */
export const SAMPLE_TOLERANCE_RATIO = 1 / 2000;
export const MIN_SAMPLES = 8;
export const MAX_SAMPLES = 512;

/**
 * Resolves DXF's bulge into a centre, a radius and a signed sweep in degrees.
 *
 * A bulge is the tangent of a quarter of the arc's included angle, so the angle comes
 * straight back out of it with an arctangent. The centre then lies on the chord's left
 * normal, at a distance the half-angle fixes - signed, so that an arc of more than a
 * semicircle puts the centre on the far side of the chord and a negative bulge sweeps
 * clockwise. Both of those sign flips fall out of the formula rather than needing cases.
 */
export function bulgeArc(
    start: { x: number; y: number },
    end: { x: number; y: number },
    bulge: number,
): { center: { x: number; y: number }; radius: number; sweep: number } | undefined {
    const theta = 4 * Math.atan(bulge);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const chord = Math.hypot(dx, dy);
    const half = Math.sin(theta / 2);
    if (chord < 1e-12 || Math.abs(half) < 1e-12) return undefined;

    const radius = chord / (2 * half);
    const offset = radius * Math.cos(theta / 2);

    return {
        center: {
            x: (start.x + end.x) / 2 + (-dy / chord) * offset,
            y: (start.y + end.y) / 2 + (dx / chord) * offset,
        },
        radius: Math.abs(radius),
        sweep: (theta * 180) / Math.PI,
    };
}

/** The bulge that carries an arc of `sweepDegrees`, the inverse of the above. */
export function bulgeOfSweep(sweepDegrees: number): number {
    return Math.tan((sweepDegrees * Math.PI) / 180 / 4);
}

/** Segment count for a curve of the given radius sweeping `sweep` radians. */
export function sampleCount(radius: number, sweep: number): number {
    const tolerance = Math.max(radius * SAMPLE_TOLERANCE_RATIO, 1e-9);
    const ratio = Math.min(1, Math.max(-1, 1 - tolerance / Math.max(radius, 1e-9)));
    const step = 2 * Math.acos(ratio);
    const count = step > 0 ? Math.ceil(Math.abs(sweep) / step) : MIN_SAMPLES;
    return Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, count));
}

/**
 * Evaluates a B-spline with De Boor's algorithm and samples it into points.
 *
 * DraftWorks has no B-spline body and the shape factory exposes no B-spline constructor,
 * so a SPLINE has to become a polyline on import. The choice worth calling out is that it
 * is sampled from the real curve rather than from its control polygon: the control points
 * are not on the curve, and treating them as if they were would visibly distort every
 * spline in an imported drawing.
 *
 * Rational splines - the ones with weights, which is how a NURBS stores an exact conic -
 * are evaluated in homogeneous coordinates and divided through at the end, so they come
 * out at the right shape rather than as their non-rational approximation.
 */
export function sampleSpline(entity: DxfSplineEntity): DxfVec[] {
    const { degree, controlPoints: control, knots } = entity;
    if (degree < 1 || control.length <= degree) return [];
    // A valid knot vector has exactly one knot per control point plus degree + 1.
    if (knots.length !== control.length + degree + 1) return [];

    const weights = entity.weights.length === control.length ? entity.weights : control.map(() => 1);
    const first = knots[degree];
    const last = knots[control.length];
    if (!(last > first)) return [];

    // Sampled per knot span rather than per unit length: a spline's curvature is bounded
    // by its spans, so this keeps a long gentle curve from being over-sampled and a short
    // tight one from being under-sampled.
    const spans = control.length - degree;
    const count = Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, spans * 16));

    const points: DxfVec[] = [];
    for (let i = 0; i <= count; i++) {
        // The final sample is clamped to the last knot exactly: floating point drift there
        // would fall outside every span and lose the curve's endpoint.
        const t = i === count ? last : first + ((last - first) * i) / count;
        const point = deBoor(degree, control, weights, knots, t);
        if (point) points.push(point);
    }
    return points;
}

export function deBoor(
    degree: number,
    control: readonly DxfVec[],
    weights: readonly number[],
    knots: readonly number[],
    t: number,
): DxfVec | undefined {
    // The knot span t falls in. The last span is half-open, so a t sitting exactly on the
    // final knot finds no span and is clamped into the last one.
    let span = -1;
    for (let i = degree; i < control.length; i++) {
        if (t >= knots[i] && t < knots[i + 1]) {
            span = i;
            break;
        }
    }
    if (span < 0) span = control.length - 1;

    // Homogeneous coordinates: interpolate (wx, wy, wz, w) and divide at the end.
    const d: number[][] = [];
    for (let j = 0; j <= degree; j++) {
        const index = span - degree + j;
        const p = control[index];
        if (!p) return undefined;
        const w = weights[index] ?? 1;
        d.push([p.x * w, p.y * w, p.z * w, w]);
    }

    for (let r = 1; r <= degree; r++) {
        for (let j = degree; j >= r; j--) {
            const index = span - degree + j;
            const low = knots[index];
            const high = knots[index + degree - r + 1];
            const denominator = high - low;
            const alpha = denominator === 0 ? 0 : (t - low) / denominator;
            for (let k = 0; k < 4; k++) {
                d[j][k] = (1 - alpha) * d[j - 1][k] + alpha * d[j][k];
            }
        }
    }

    const result = d[degree];
    const w = result[3];
    if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return undefined;
    return dxfVec(result[0] / w, result[1] / w, result[2] / w);
}
