import { Precision } from "../foundation/precision";
import { DimensionSetup } from "../foundation/unitSetup";
import { XYZ } from "../math";

export const DimensionTypes = ["linear", "aligned", "angular", "radius", "diameter"] as const;
export type DimensionType = (typeof DimensionTypes)[number];

/**
 * Everything needed to draw one dimension, in world space. Kept as flat vertex arrays
 * because that is what the renderer wants - lines go into a LineSegments buffer (point
 * pairs) and arrows into a triangle buffer.
 *
 * This is pure geometry with no rendering types in it, so the layout of a dimension can
 * be reasoned about (and corrected) without touching three.js.
 */
export interface DimensionGeometry {
    /** Point pairs: [ax,ay,az, bx,by,bz, ...]. Extension lines and the dimension line. */
    lines: number[];
    /** Triangles: 3 vertices each. The filled arrowheads. */
    arrows: number[];
    /** Where the measurement text is anchored. */
    textPosition: XYZ;
    /** The formatted measurement, e.g. `125.00`, `R25.00`, `⌀50.00`, `45.00°`. */
    text: string;
    /** The raw measured quantity, in drawing units (degrees for angular). */
    value: number;
}

/**
 * The frame a dimension is laid out in. `normal` is the drawing plane's normal, which
 * fixes what "perpendicular" and "counter-clockwise" mean; `xAxis` fixes which way is
 * horizontal, so a linear dimension can decide between horizontal and vertical.
 */
export interface DimensionFrame {
    normal: XYZ;
    xAxis: XYZ;
}

/** Fraction of the arrow's length used for its half-width - a slim AutoCAD-style head. */
const ARROW_HALF_WIDTH_RATIO = 0.16;
/** How far an extension line runs past the dimension line, as a multiple of arrow size. */
const EXTENSION_OVERSHOOT = 0.6;
/** Gap between the dimension line and the text sitting above it, relative to text height. */
const TEXT_GAP_RATIO = 0.7;
/** Below this, a measurement is treated as degenerate and the dimension draws nothing. */
const MIN_EXTENT = Precision.Distance;

const push = (target: number[], ...points: XYZ[]) => {
    for (const p of points) target.push(p.x, p.y, p.z);
};

const unit = (vector: XYZ, fallback: XYZ) => vector.normalize() ?? fallback;

/**
 * A filled triangle whose tip is at `tip` and whose base is `size` back along
 * `direction`. `normal` is the plane the triangle lies in.
 */
function arrowHead(target: number[], tip: XYZ, direction: XYZ, normal: XYZ, size: number) {
    const back = tip.add(direction.multiply(size));
    const side = unit(normal.cross(direction), XYZ.unitX).multiply(size * ARROW_HALF_WIDTH_RATIO);
    push(target, tip, back.add(side), back.sub(side));
}

/**
 * Lays out a linear or aligned dimension.
 *
 * `aligned` measures the true distance between the two points and runs the dimension
 * line parallel to them. `linear` measures only the horizontal or vertical component -
 * which one is decided by where the dimension line was dragged, the way AutoCAD's
 * DIMLINEAR resolves it - so the dimension line stays axis-parallel.
 */
function linearGeometry(
    type: "linear" | "aligned",
    start: XYZ,
    end: XYZ,
    offsetPoint: XYZ,
    frame: DimensionFrame,
): DimensionGeometry | undefined {
    const { textHeight, arrowSize, extensionOffset } = DimensionSetup.settings;
    const normal = frame.normal;
    const span = end.sub(start);
    if (span.length() < MIN_EXTENT) return undefined;

    const direction = resolveDirection(type, span, start, offsetPoint, frame);
    if (!direction) return undefined;

    // In-plane perpendicular to the dimension line; the dimension line sits this far off.
    const perpendicular = unit(normal.cross(direction), frame.xAxis);
    const offsetDistance = offsetPoint.sub(start).dot(perpendicular);
    const offset = perpendicular.multiply(offsetDistance);

    // Dimension-line endpoints are the two origin points projected onto the offset line.
    const base = start.add(offset);
    const q1 = base.add(direction.multiply(start.sub(base).dot(direction)));
    const q2 = base.add(direction.multiply(end.sub(base).dot(direction)));

    const value = q1.distanceTo(q2);
    if (value < MIN_EXTENT) return undefined;

    const lines: number[] = [];
    const arrows: number[] = [];

    // Extension lines: start clear of the object by extensionOffset, finish just past
    // the dimension line.
    extensionLine(lines, start, q1, extensionOffset, arrowSize * EXTENSION_OVERSHOOT);
    extensionLine(lines, end, q2, extensionOffset, arrowSize * EXTENSION_OVERSHOOT);

    push(lines, q1, q2);

    // Arrow tips touch the dimension-line ends, pointing back in towards each other.
    const along = unit(q2.sub(q1), direction);
    arrowHead(arrows, q1, along, normal, arrowSize);
    arrowHead(arrows, q2, along.reverse(), normal, arrowSize);

    // Text sits above the dimension line, on the side the user dragged it to.
    const textSide = offsetDistance >= 0 ? perpendicular : perpendicular.reverse();
    const textPosition = q1
        .add(q2)
        .multiply(0.5)
        .add(textSide.multiply(textHeight * TEXT_GAP_RATIO));

    return { lines, arrows, textPosition, text: DimensionSetup.formatLength(value), value };
}

/**
 * Which way the dimension line runs. Aligned follows the measured span; linear picks the
 * frame axis from which side of the two origins the dimension line was dragged past.
 */
function resolveDirection(
    type: "linear" | "aligned",
    span: XYZ,
    start: XYZ,
    offsetPoint: XYZ,
    frame: DimensionFrame,
): XYZ | undefined {
    if (type === "aligned") return span.normalize();

    const xAxis = unit(frame.xAxis, XYZ.unitX);
    const yAxis = unit(frame.normal.cross(xAxis), XYZ.unitY);

    // AutoCAD resolves DIMLINEAR by where the dimension line sits relative to the *pair*
    // of origins, so measure the drag from the midpoint and discount the span's own half
    // extent on each axis. Measuring from `start` let a long span outvote the drag: on a
    // wide horizontal span, dragging straight up still read as "sideways" and produced a
    // vertical dimension of zero length, which draws nothing at all.
    const toOffset = offsetPoint.sub(start.add(span.multiply(0.5)));
    const beyondX = Math.abs(toOffset.dot(xAxis)) - Math.abs(span.dot(xAxis)) / 2;
    const beyondY = Math.abs(toOffset.dot(yAxis)) - Math.abs(span.dot(yAxis)) / 2;

    // Clear of the origins vertically asks for a horizontal dimension, and vice versa.
    return beyondY >= beyondX ? xAxis : yAxis;
}

function extensionLine(target: number[], origin: XYZ, to: XYZ, gap: number, overshoot: number) {
    const span = to.sub(origin);
    const length = span.length();
    if (length < MIN_EXTENT) return;

    const direction = unit(span, XYZ.unitX);
    // A gap larger than the offset itself would invert the line, so clamp it.
    const from = origin.add(direction.multiply(Math.min(gap, length)));
    push(target, from, to.add(direction.multiply(overshoot)));
}

/**
 * DIMRADIUS: a leader from the centre out through the arc, arrowhead touching the arc,
 * labelled `R<value>`. The pick point only chooses the direction the leader leaves in.
 */
function radiusGeometry(
    center: XYZ,
    radius: number,
    offsetPoint: XYZ,
    frame: DimensionFrame,
): DimensionGeometry | undefined {
    if (radius < MIN_EXTENT) return undefined;

    const { arrowSize, textHeight } = DimensionSetup.settings;
    const direction = unit(offsetPoint.sub(center), frame.xAxis);
    const onArc = center.add(direction.multiply(radius));

    const lines: number[] = [];
    const arrows: number[] = [];
    push(lines, center, onArc);

    // Tip on the arc, pointing back down the leader - AutoCAD's inside-the-arc arrow.
    arrowHead(arrows, onArc, direction.reverse(), frame.normal, arrowSize);

    // Text just outside the arc, clear of the arrowhead.
    const textPosition = center.add(direction.multiply(radius + textHeight * TEXT_GAP_RATIO));

    return {
        lines,
        arrows,
        textPosition,
        text: `R${DimensionSetup.formatLength(radius)}`,
        value: radius,
    };
}

/**
 * DIMDIAMETER: the full chord through the centre with an arrowhead at each end,
 * labelled `⌀<value>`.
 */
function diameterGeometry(
    center: XYZ,
    radius: number,
    offsetPoint: XYZ,
    frame: DimensionFrame,
): DimensionGeometry | undefined {
    if (radius < MIN_EXTENT) return undefined;

    const { arrowSize, textHeight } = DimensionSetup.settings;
    const direction = unit(offsetPoint.sub(center), frame.xAxis);
    const near = center.sub(direction.multiply(radius));
    const far = center.add(direction.multiply(radius));

    const lines: number[] = [];
    const arrows: number[] = [];
    push(lines, near, far);
    arrowHead(arrows, near, direction, frame.normal, arrowSize);
    arrowHead(arrows, far, direction.reverse(), frame.normal, arrowSize);

    const perpendicular = unit(frame.normal.cross(direction), frame.xAxis);
    const textPosition = center.add(perpendicular.multiply(textHeight * TEXT_GAP_RATIO));

    return {
        lines,
        arrows,
        textPosition,
        text: `⌀${DimensionSetup.formatLength(radius * 2)}`,
        value: radius * 2,
    };
}

/** Segments used to approximate the dimension arc; enough that it reads as smooth. */
const ARC_SEGMENTS = 48;

const TWO_PI = Math.PI * 2;

/**
 * The sweep from `from` to `to` that passes through `through`, signed: positive
 * counter-clockwise about `normal`, negative clockwise. Undefined if any of the three
 * directions is degenerate.
 */
function signedSweep(from: XYZ, to: XYZ, through: XYZ, normal: XYZ): number | undefined {
    const counterClockwise = from.angleOnPlaneTo(to, normal);
    if (counterClockwise === undefined) return undefined;

    const toThrough = from.angleOnPlaneTo(through, normal);
    if (toThrough === undefined) return counterClockwise;

    // Outside the counter-clockwise span means the user dragged the other way round.
    return toThrough > counterClockwise ? counterClockwise - TWO_PI : counterClockwise;
}

/**
 * DIMANGULAR: the angle at `vertex` between the rays to `start` and `end`, drawn as an
 * arc at the radius the user dragged to, with extension lines out to it.
 */
function angularGeometry(
    vertex: XYZ,
    start: XYZ,
    end: XYZ,
    offsetPoint: XYZ,
    frame: DimensionFrame,
): DimensionGeometry | undefined {
    const { arrowSize, textHeight } = DimensionSetup.settings;
    const normal = frame.normal;

    const ray1 = start.sub(vertex).normalize();
    const ray2 = end.sub(vertex).normalize();
    if (!ray1 || !ray2) return undefined;

    // angleOnPlaneTo always sweeps counter-clockwise in [0, 2PI), which would report the
    // reflex angle half the time. AutoCAD instead measures the angle whose arc contains
    // the point you dragged the dimension arc to, so a drag on the far side gives the
    // reflex angle deliberately. Sweeping backwards when the drag falls outside the
    // counter-clockwise span reproduces that.
    const sweep = signedSweep(ray1, ray2, offsetPoint.sub(vertex), normal);
    if (sweep === undefined || Math.abs(sweep) < Precision.Angle) return undefined;

    const radius = Math.max(vertex.distanceTo(offsetPoint), arrowSize * 2);

    const lines: number[] = [];
    const arrows: number[] = [];

    // Extension lines run from each picked point out to the arc.
    for (const ray of [ray1, ray2]) {
        push(lines, vertex.add(ray.multiply(arrowSize)), vertex.add(ray.multiply(radius + arrowSize)));
    }

    // The arc itself, as a polyline.
    const pointAt = (t: number) => vertex.add(ray1.rotate(normal, sweep * t)!.multiply(radius));
    let previous = pointAt(0);
    for (let i = 1; i <= ARC_SEGMENTS; i++) {
        const current = pointAt(i / ARC_SEGMENTS);
        push(lines, previous, current);
        previous = current;
    }

    // Arrowheads tangent to the arc at each end, pointing along it.
    const tangentAt = (point: XYZ, forward: boolean) => {
        const radial = unit(point.sub(vertex), frame.xAxis);
        const tangent = unit(normal.cross(radial), frame.xAxis);
        return sweep > 0 === forward ? tangent : tangent.reverse();
    };
    const arcStart = pointAt(0);
    const arcEnd = pointAt(1);
    arrowHead(arrows, arcStart, tangentAt(arcStart, true), normal, arrowSize);
    arrowHead(arrows, arcEnd, tangentAt(arcEnd, false), normal, arrowSize);

    const midRadial = unit(pointAt(0.5).sub(vertex), frame.xAxis);
    const textPosition = vertex.add(midRadial.multiply(radius + textHeight * TEXT_GAP_RATIO));

    const degrees = Math.abs((sweep * 180) / Math.PI);
    return {
        lines,
        arrows,
        textPosition,
        text: `${DimensionSetup.formatDecimal(degrees)}°`,
        value: degrees,
    };
}

export interface DimensionInput {
    type: DimensionType;
    /** Linear/aligned: first origin. Angular: the vertex. Radius/diameter: the centre. */
    start: XYZ;
    /** Linear/aligned: second origin. Angular: a point on the first ray. */
    end: XYZ;
    /** Angular only: a point on the second ray. */
    third?: XYZ;
    /** Where the dimension line / leader was dragged to. */
    offsetPoint: XYZ;
    /** Radius/diameter only. */
    radius?: number;
    frame: DimensionFrame;
}

/**
 * Builds the line work, arrowheads and label for one dimension. Returns undefined for
 * a degenerate input (zero-length span, zero radius, collinear rays) rather than
 * emitting a malformed dimension.
 */
export function buildDimensionGeometry(input: DimensionInput): DimensionGeometry | undefined {
    switch (input.type) {
        case "linear":
        case "aligned":
            return linearGeometry(input.type, input.start, input.end, input.offsetPoint, input.frame);
        case "radius":
            return radiusGeometry(input.start, input.radius ?? 0, input.offsetPoint, input.frame);
        case "diameter":
            return diameterGeometry(input.start, input.radius ?? 0, input.offsetPoint, input.frame);
        case "angular":
            return input.third
                ? angularGeometry(input.start, input.end, input.third, input.offsetPoint, input.frame)
                : undefined;
        default:
            return undefined;
    }
}
