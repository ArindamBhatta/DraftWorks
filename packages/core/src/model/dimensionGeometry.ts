import { Precision } from "../foundation/precision";
import {
    type ArrowheadType,
    type DimensionLabel,
    type DimensionSettings,
    DimensionSetup,
    flattenDimensionLabel,
    formatDimensionLabel,
} from "../foundation/unitSetup";
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
    /**
     * Every line in the dimension. Kept alongside the split arrays below for callers that
     * only want the line work and have nowhere to put a second colour - the DXF exporter
     * and the in-progress drag preview.
     */
    lines: number[];
    /**
     * The dimension line and any stroked arrowheads, which DIMCLRD colours together.
     * Point pairs: [ax,ay,az, bx,by,bz, ...].
     */
    dimensionLines: number[];
    /** The extension lines and centre marks, coloured by DIMCLRE. */
    extensionLines: number[];
    /** Triangles: 3 vertices each. The filled arrowheads. */
    arrows: number[];
    /** Where the measurement text is anchored. */
    textPosition: XYZ;
    /**
     * How far the label is turned within the drawing plane, in radians counter-clockwise
     * about the frame normal. Always 0 under `horizontal` text alignment, and kept within
     * a quarter turn of upright otherwise so the text never reads upside down.
     */
    textRotation: number;
    /** The formatted measurement as plain text, e.g. `125.00`, `R25.00`, `⌀50.00`, `45.00°`. */
    text: string;
    /** The same label with its parts kept apart - tolerance, alternate units, box. */
    label: DimensionLabel;
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
/** Half-angle of the barbs on the stroked `open` heads. */
const OPEN_ARROW_HALF_ANGLE = Math.PI / 9;
/** Radius of the `dot` head, relative to arrow size. */
const DOT_RADIUS_RATIO = 0.3;
/** Segments in a `dot` head - enough that it reads as round at any sane zoom. */
const DOT_SEGMENTS = 12;
/** Below this, a measurement is treated as degenerate and the dimension draws nothing. */
const MIN_EXTENT = Precision.Distance;
/**
 * Average glyph advance as a fraction of text height, used to guess how wide a label will
 * be. The app renders dimension text as HTML, so its true width is not knowable here - and
 * the Fit rules only need to know whether the label is roughly wider than the span, which
 * this is accurate enough to answer.
 */
const TEXT_WIDTH_RATIO = 0.6;

const push = (target: number[], ...points: XYZ[]) => {
    for (const p of points) target.push(p.x, p.y, p.z);
};

const unit = (vector: XYZ, fallback: XYZ) => vector.normalize() ?? fallback;

/**
 * The style's sizes with DIMSCALE folded in.
 *
 * Every length that describes the *drawing* of a dimension rather than the thing it
 * measures is scaled here, once, so no layout code below has to remember to do it - and
 * the measurement itself is untouched, which is the whole point of DIMSCALE.
 */
interface ScaledStyle extends DimensionSettings {
    s_textHeight: number;
    s_arrowSize: number;
    s_extensionOffset: number;
    s_extensionBeyond: number;
    s_extensionLength: number;
    s_dimLineExtend: number;
    s_textOffset: number;
    s_centerMarkSize: number;
}

function scaled(overrides?: Partial<DimensionSettings>): ScaledStyle {
    const settings = DimensionSetup.resolve(overrides);
    const k = settings.overallScale;
    return {
        ...settings,
        s_textHeight: settings.textHeight * k,
        s_arrowSize: settings.arrowSize * k,
        s_extensionOffset: settings.extensionOffset * k,
        s_extensionBeyond: settings.extensionBeyondDimLine * k,
        s_extensionLength: settings.extensionLength * k,
        s_dimLineExtend: settings.dimLineExtend * k,
        s_textOffset: settings.textOffset * k,
        s_centerMarkSize: settings.centerMarkSize * k,
    };
}

/** Rough width of a label, for the Fit rules - see TEXT_WIDTH_RATIO. */
function labelWidth(label: DimensionLabel, textHeight: number): number {
    const tolerance = label.tolerance;
    const widest = Math.max(
        label.text.length,
        label.secondary?.length ?? 0,
        // Stacked tolerance text is drawn smaller, so it takes proportionally less room.
        Math.max(tolerance?.upper.length ?? 0, tolerance?.lower?.length ?? 0) * label.toleranceScale,
    );
    return widest * textHeight * TEXT_WIDTH_RATIO;
}

/**
 * Draws one arrowhead of the requested shape, with its point at `tip`.
 *
 * `direction` points from the tip back along the dimension line - into the measurement -
 * so a head is drawn by walking away from the tip along it. Filled shapes go to
 * `triangles`, stroked ones to `strokes`; both belong to the dimension line's colour.
 */
function arrowHead(
    triangles: number[],
    strokes: number[],
    type: ArrowheadType,
    tip: XYZ,
    direction: XYZ,
    normal: XYZ,
    size: number,
) {
    if (type === "none" || size < MIN_EXTENT) return;

    const side = unit(normal.cross(direction), XYZ.unitX);
    const back = tip.add(direction.multiply(size));

    switch (type) {
        case "closedFilled": {
            const half = side.multiply(size * ARROW_HALF_WIDTH_RATIO);
            push(triangles, tip, back.add(half), back.sub(half));
            return;
        }
        case "closed":
        case "closedBlank": {
            const half = side.multiply(size * ARROW_HALF_WIDTH_RATIO);
            const left = back.add(half);
            const right = back.sub(half);
            push(strokes, tip, left, tip, right);
            // The only difference between the two: `closed` is a shut triangle, while
            // `closedBlank` leaves the base open as a bare V.
            if (type === "closed") push(strokes, left, right);
            return;
        }
        case "dot": {
            const radius = size * DOT_RADIUS_RATIO;
            const center = tip.add(direction.multiply(radius));
            // A fan of triangles rather than a circle primitive: the arrow buffer holds
            // triangles only, and at this size a dozen segments already reads as round.
            let previous = center.add(side.multiply(radius));
            for (let i = 1; i <= DOT_SEGMENTS; i++) {
                const angle = (i / DOT_SEGMENTS) * Math.PI * 2;
                const current = center.add(
                    side.multiply(Math.cos(angle) * radius).add(direction.multiply(Math.sin(angle) * radius)),
                );
                push(triangles, center, previous, current);
                previous = current;
            }
            return;
        }
        case "architecturalTick":
        case "oblique": {
            // The 45° slash architectural drawings use instead of an arrow. Oblique is
            // simply the longer of the two.
            const length = type === "oblique" ? size * 0.75 : size * 0.5;
            const slash = unit(direction.add(side), direction).multiply(length);
            push(strokes, tip.sub(slash), tip.add(slash));
            return;
        }
        case "open":
        case "openReversed":
        case "right": {
            const halfAngle = type === "right" ? Math.PI / 4 : OPEN_ARROW_HALF_ANGLE;
            // `openReversed` is the same barbs swept the other way, so they open towards
            // the outside of the dimension rather than back along it.
            const along = type === "openReversed" ? direction.reverse() : direction;
            const cos = Math.cos(halfAngle) * size;
            const sin = Math.sin(halfAngle) * size;
            const left = tip.add(along.multiply(cos)).add(side.multiply(sin));
            const right = tip.add(along.multiply(cos)).sub(side.multiply(sin));
            push(strokes, tip, left, tip, right);
            return;
        }
    }
}

/**
 * The in-plane angle of `direction`, measured from the frame's x axis. Folded into
 * [-PI/2, PI/2] so a label following a dimension line never ends up upside down - the
 * same thing AutoCAD does when it flips text on a right-to-left dimension.
 */
function readableAngle(direction: XYZ, frame: DimensionFrame): number {
    const xAxis = unit(frame.xAxis, XYZ.unitX);
    const yAxis = unit(frame.normal.cross(xAxis), XYZ.unitY);
    let angle = Math.atan2(direction.dot(yAxis), direction.dot(xAxis));
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    return angle;
}

/** DIMTIH/DIMTOH: `aligned` follows the dimension line, `iso` only while text is inside. */
function textRotation(style: ScaledStyle, direction: XYZ, frame: DimensionFrame, inside: boolean): number {
    if (style.textAlignment === "horizontal") return 0;
    if (style.textAlignment === "iso" && !inside) return 0;
    return readableAngle(direction, frame);
}

/**
 * Where the label goes relative to the dimension line, as a multiple of the perpendicular.
 *
 * `outward` is the side the dimension line was dragged to, so `outside` placement puts the
 * text further out and `below` puts it on the object's side, matching DIMTAD.
 */
function verticalTextShift(style: ScaledStyle): number {
    const clear = style.s_textOffset + style.s_textHeight / 2;
    switch (style.textVertical) {
        case "centered":
            return 0;
        case "below":
            return -clear;
        // `above` and `outside` differ only for text that has been pushed past the
        // extension lines, which this app has no way to drag it to - so both read as
        // "clear of the line, on the side it was dragged to".
        default:
            return clear;
    }
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
    overrides?: Partial<DimensionSettings>,
): DimensionGeometry | undefined {
    const style = scaled(overrides);
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

    const dimensionLines: number[] = [];
    const extensionLines: number[] = [];
    const arrows: number[] = [];

    const label = formatDimensionLabel(value, style, "length");
    const along = unit(q2.sub(q1), direction);

    // --- Fit: does the label, plus a head at each end, fit between the extension lines?
    const width = labelWidth(label, style.s_textHeight);
    const arrowRoom = style.s_arrowSize * 2;
    const fits = width + arrowRoom <= value;
    const { textInside, arrowsInside } = resolveFit(style.fit, fits, width, arrowRoom, value);

    // --- Extension lines.
    if (!style.suppressExtLine1) {
        extensionLine(extensionLines, start, q1, style);
    }
    if (!style.suppressExtLine2) {
        extensionLine(extensionLines, end, q2, style);
    }

    // --- Dimension line, in halves so DIMSD1/DIMSD2 can drop either one.
    // Centred text breaks the line to make room for itself, exactly as AutoCAD draws it.
    // Capped at half the span: a gap wider than that would put each half's inner end past
    // the far extension line, drawing the two halves backwards through each other.
    const gap =
        style.textVertical === "centered" && textInside
            ? Math.min(width / 2 + style.s_textOffset, value / 2)
            : 0;
    const middle = q1.add(q2).multiply(0.5);
    const suppressed = style.suppressDimLine1 && style.suppressDimLine2;

    if (!suppressed && (arrowsInside || style.drawDimLineBetweenExtLines)) {
        if (!style.suppressDimLine1) {
            push(dimensionLines, q1, gap > 0 ? middle.sub(along.multiply(gap)) : middle);
        }
        if (!style.suppressDimLine2) {
            push(dimensionLines, gap > 0 ? middle.add(along.multiply(gap)) : middle, q2);
        }
    }

    // DIMDLE: the dimension line running on past the extension lines. AutoCAD only draws
    // it with the tick-style heads, where there is no arrow filling that space.
    const usesTicks = style.arrowhead1 === "architecturalTick" || style.arrowhead1 === "oblique";
    if (style.s_dimLineExtend > 0 && usesTicks && !suppressed) {
        push(dimensionLines, q1, q1.sub(along.multiply(style.s_dimLineExtend)));
        push(dimensionLines, q2, q2.add(along.multiply(style.s_dimLineExtend)));
    }

    // --- Arrowheads. Inside they point back towards each other; pushed outside by Fit
    // they swap sides and point inwards from beyond the extension lines, and get a short
    // stub of dimension line to sit on.
    const inward1 = arrowsInside ? along : along.reverse();
    const inward2 = arrowsInside ? along.reverse() : along;
    arrowHead(arrows, dimensionLines, style.arrowhead1, q1, inward1, normal, style.s_arrowSize);
    arrowHead(arrows, dimensionLines, style.arrowhead2, q2, inward2, normal, style.s_arrowSize);
    if (!arrowsInside && !suppressed) {
        push(dimensionLines, q1, q1.sub(along.multiply(style.s_arrowSize * 2)));
        push(dimensionLines, q2, q2.add(along.multiply(style.s_arrowSize * 2)));
    }

    // --- Text.
    const textSide = offsetDistance >= 0 ? perpendicular : perpendicular.reverse();
    let anchor = middle;
    if (!textInside) {
        // Past the second extension line, clear of whatever head is drawn there.
        anchor = q2.add(along.multiply(style.s_arrowSize * 2 + width / 2));
    } else if (style.textHorizontal === "atExt1") {
        anchor = q1.add(along.multiply(width / 2 + style.s_arrowSize));
    } else if (style.textHorizontal === "atExt2") {
        anchor = q2.sub(along.multiply(width / 2 + style.s_arrowSize));
    }
    const textPosition = anchor.add(textSide.multiply(verticalTextShift(style)));

    return finish(
        dimensionLines,
        extensionLines,
        arrows,
        textPosition,
        textRotation(style, along, frame, textInside),
        label,
        value,
    );
}

/**
 * Which of the label and the arrowheads stay between the extension lines when there is
 * not room for both - DIMATFIT, plus DIMTIX for the "always keep text inside" case.
 */
function resolveFit(
    fit: DimensionSettings["fit"],
    fits: boolean,
    width: number,
    arrowRoom: number,
    span: number,
): { textInside: boolean; arrowsInside: boolean } {
    if (fits) return { textInside: true, arrowsInside: true };

    switch (fit) {
        case "text":
            return { textInside: false, arrowsInside: true };
        case "arrows":
            return { textInside: true, arrowsInside: false };
        case "both":
            return { textInside: false, arrowsInside: false };
        case "textAlways":
            return { textInside: true, arrowsInside: arrowRoom <= span };
        default:
            // "either": move out whichever one alone would still not leave room for the
            // other, preferring to keep the text - a dimension you cannot read is worse
            // than one whose heads sit outside.
            return { textInside: width <= span, arrowsInside: width > span };
    }
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

/**
 * One extension line, from just clear of the measured point out past the dimension line.
 *
 * DIMFXLON turns this round: instead of running the whole way from the object, the line
 * is measured back from the dimension line by DIMFXL, so a row of dimensions at different
 * offsets still gets extension lines of one length.
 */
function extensionLine(target: number[], origin: XYZ, to: XYZ, style: ScaledStyle) {
    const span = to.sub(origin);
    const length = span.length();
    if (length < MIN_EXTENT) return;

    const direction = unit(span, XYZ.unitX);
    const end = to.add(direction.multiply(style.s_extensionBeyond));

    if (style.fixedExtensionLength) {
        const from = to.sub(direction.multiply(Math.min(style.s_extensionLength, length)));
        push(target, from, end);
        return;
    }

    // A gap larger than the offset itself would invert the line, so clamp it.
    const from = origin.add(direction.multiply(Math.min(style.s_extensionOffset, length)));
    push(target, from, end);
}

/** DIMCEN: the cross, and optionally the full centre lines, at a circle's centre. */
function centerMark(
    target: number[],
    center: XYZ,
    radius: number,
    style: ScaledStyle,
    frame: DimensionFrame,
) {
    if (style.centerMark === "none") return;

    const xAxis = unit(frame.xAxis, XYZ.unitX);
    const yAxis = unit(frame.normal.cross(xAxis), XYZ.unitY);
    const size = style.s_centerMarkSize;

    for (const axis of [xAxis, yAxis]) {
        push(target, center.sub(axis.multiply(size)), center.add(axis.multiply(size)));
        if (style.centerMark === "line") {
            // Centre *lines* also run from just outside the circle outwards on both sides.
            const inner = axis.multiply(radius);
            const outer = axis.multiply(radius + size);
            push(target, center.add(inner), center.add(outer));
            push(target, center.sub(inner), center.sub(outer));
        }
    }
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
    overrides?: Partial<DimensionSettings>,
): DimensionGeometry | undefined {
    if (radius < MIN_EXTENT) return undefined;

    const style = scaled(overrides);
    const direction = unit(offsetPoint.sub(center), frame.xAxis);
    const onArc = center.add(direction.multiply(radius));

    const dimensionLines: number[] = [];
    const extensionLines: number[] = [];
    const arrows: number[] = [];
    push(dimensionLines, center, onArc);
    centerMark(extensionLines, center, radius, style, frame);

    // Tip on the arc, pointing back down the leader - AutoCAD's inside-the-arc arrow.
    arrowHead(
        arrows,
        dimensionLines,
        style.leaderArrowhead,
        onArc,
        direction.reverse(),
        frame.normal,
        style.s_arrowSize,
    );

    const label = formatDimensionLabel(radius, style, "length", "R");
    // Text just outside the arc, clear of the arrowhead.
    const clear = style.s_textOffset + style.s_textHeight / 2;
    const textPosition = center.add(direction.multiply(radius + clear));

    return finish(
        dimensionLines,
        extensionLines,
        arrows,
        textPosition,
        textRotation(style, direction, frame, true),
        label,
        radius,
    );
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
    overrides?: Partial<DimensionSettings>,
): DimensionGeometry | undefined {
    if (radius < MIN_EXTENT) return undefined;

    const style = scaled(overrides);
    const direction = unit(offsetPoint.sub(center), frame.xAxis);
    const near = center.sub(direction.multiply(radius));
    const far = center.add(direction.multiply(radius));

    const dimensionLines: number[] = [];
    const extensionLines: number[] = [];
    const arrows: number[] = [];
    push(dimensionLines, near, far);
    centerMark(extensionLines, center, radius, style, frame);
    arrowHead(arrows, dimensionLines, style.arrowhead1, near, direction, frame.normal, style.s_arrowSize);
    arrowHead(
        arrows,
        dimensionLines,
        style.arrowhead2,
        far,
        direction.reverse(),
        frame.normal,
        style.s_arrowSize,
    );

    const label = formatDimensionLabel(radius * 2, style, "length", "⌀");
    const perpendicular = unit(frame.normal.cross(direction), frame.xAxis);
    const textPosition = center.add(perpendicular.multiply(style.s_textOffset + style.s_textHeight / 2));

    return finish(
        dimensionLines,
        extensionLines,
        arrows,
        textPosition,
        textRotation(style, direction, frame, true),
        label,
        radius * 2,
    );
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
    overrides?: Partial<DimensionSettings>,
): DimensionGeometry | undefined {
    const style = scaled(overrides);
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

    const radius = Math.max(vertex.distanceTo(offsetPoint), style.s_arrowSize * 2);

    const dimensionLines: number[] = [];
    const extensionLines: number[] = [];
    const arrows: number[] = [];

    // Extension lines run from each picked point out to the arc.
    const suppress = [style.suppressExtLine1, style.suppressExtLine2];
    [ray1, ray2].forEach((ray, index) => {
        if (suppress[index]) return;
        push(
            extensionLines,
            vertex.add(ray.multiply(style.s_extensionOffset + style.s_arrowSize)),
            vertex.add(ray.multiply(radius + style.s_extensionBeyond)),
        );
    });

    // The arc itself, as a polyline.
    const pointAt = (t: number) => vertex.add(ray1.rotate(normal, sweep * t)!.multiply(radius));
    let previous = pointAt(0);
    for (let i = 1; i <= ARC_SEGMENTS; i++) {
        const current = pointAt(i / ARC_SEGMENTS);
        push(dimensionLines, previous, current);
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
    arrowHead(
        arrows,
        dimensionLines,
        style.arrowhead1,
        arcStart,
        tangentAt(arcStart, true),
        normal,
        style.s_arrowSize,
    );
    arrowHead(
        arrows,
        dimensionLines,
        style.arrowhead2,
        arcEnd,
        tangentAt(arcEnd, false),
        normal,
        style.s_arrowSize,
    );

    const midRadial = unit(pointAt(0.5).sub(vertex), frame.xAxis);
    const textPosition = vertex.add(midRadial.multiply(radius + style.s_textOffset + style.s_textHeight / 2));

    const degrees = Math.abs((sweep * 180) / Math.PI);
    const label = formatDimensionLabel(degrees, style, "angle");

    // An angular label follows the arc's tangent under `aligned`, not a straight line.
    const tangent = unit(normal.cross(midRadial), frame.xAxis);
    return finish(
        dimensionLines,
        extensionLines,
        arrows,
        textPosition,
        textRotation(style, tangent, frame, true),
        label,
        degrees,
    );
}

/** Assembles the result, including the combined `lines` array every caller shares. */
function finish(
    dimensionLines: number[],
    extensionLines: number[],
    arrows: number[],
    textPosition: XYZ,
    rotation: number,
    label: DimensionLabel,
    value: number,
): DimensionGeometry {
    return {
        lines: [...dimensionLines, ...extensionLines],
        dimensionLines,
        extensionLines,
        arrows,
        textPosition,
        textRotation: rotation,
        text: flattenDimensionLabel(label),
        label,
        value,
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
    /**
     * Lay this dimension out with these settings instead of the drawing's active ones.
     * Only the Dimension Style dialog's preview passes this, so it can show settings the
     * user has typed but not confirmed. Everything else omits it and gets DIMSTYLE.
     */
    settings?: Partial<DimensionSettings>;
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
            return linearGeometry(
                input.type,
                input.start,
                input.end,
                input.offsetPoint,
                input.frame,
                input.settings,
            );
        case "radius":
            return radiusGeometry(
                input.start,
                input.radius ?? 0,
                input.offsetPoint,
                input.frame,
                input.settings,
            );
        case "diameter":
            return diameterGeometry(
                input.start,
                input.radius ?? 0,
                input.offsetPoint,
                input.frame,
                input.settings,
            );
        case "angular":
            return input.third
                ? angularGeometry(
                      input.start,
                      input.end,
                      input.third,
                      input.offsetPoint,
                      input.frame,
                      input.settings,
                  )
                : undefined;
        default:
            return undefined;
    }
}

/** One arrowhead's line work, for a picker that draws each shape as itself. */
export interface ArrowheadSample {
    /** Filled triangles, 3 vertices each - the same layout as `DimensionGeometry.arrows`. */
    triangles: number[];
    /** Stroked segments, point pairs - the same layout as `dimensionLines`. */
    strokes: number[];
}

/**
 * Draws one arrowhead on its own, pointing left along +X, with its tip at the origin.
 *
 * This exists for the Symbols and Arrows tab's swatches, which have to show each shape
 * as itself - "Closed filled" and "Closed blank" are not distinguishable by name. It
 * calls the same `arrowHead` the real dimensions are built from rather than redrawing
 * the shapes, so a swatch cannot end up showing something the drawing would not.
 */
export function arrowheadSample(type: ArrowheadType, size = 1): ArrowheadSample {
    const triangles: number[] = [];
    const strokes: number[] = [];
    // +X is "back along the dimension line" here, so the head points at -X and the
    // swatch reads left-to-right like the end of a dimension line.
    arrowHead(triangles, strokes, type, XYZ.zero, XYZ.unitX, XYZ.unitZ, size);
    return { triangles, strokes };
}
