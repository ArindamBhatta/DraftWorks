// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MathUtils, type Plane, type XYZ } from "../math";

/**
 * AutoCAD's dynamic input, expressed as pure geometry.
 *
 * While a point is being picked with something to measure from, the cursor carries
 * two live readings of the offset from the reference point - how far and at what
 * angle, or the two lengths along the axes, depending on what the prompt is asking
 * for (see DynamicInputMode). Typing into one locks it, and the other keeps
 * following the mouse: lock the distance and the point rides a circle, lock the
 * angle and it rides a ray, lock x and it rides a vertical line. Locking both fixes
 * the point outright, which is how `10` Tab `45` Enter draws an exact segment - or
 * `10` Tab `6` Enter an exact rectangle - without ever touching the command line.
 *
 * Everything here is deliberately free of snapping, views and DOM so the constraint
 * maths can be tested on its own - see dynamicInput.test.ts. The handler that owns
 * the live pick calls applyDynamicLocks() after snapping has had its say.
 */

/** Distance and angle from a reference point, in the drawing plane's own frame. */
export interface PolarReading {
    distance: number;
    /** Degrees counter-clockwise from the plane's x axis, normalised to [0, 360). */
    angle: number;
}

/** The same offset read along the plane's own axes. */
export interface CartesianReading {
    dx: number;
    dy: number;
}

/**
 * Which pair of boxes a prompt puts at the crosshair - AutoCAD's two kinds of
 * pointer input.
 *
 * A prompt that asks how far and which way ("Specify next point", "Specify radius")
 * takes polar, and a prompt whose answer is two lengths along the axes takes
 * cartesian: RECTANG's other corner is `@10,6`, not a distance at an angle, so the
 * boxes have to be the two the user would have typed. See SnapData.dynamicInputMode.
 */
export type DynamicInputMode = "polar" | "cartesian";

/** Both ways of reading one offset, so a widget can show whichever pair it wants. */
export interface DynamicInputReading extends PolarReading, CartesianReading {}

/**
 * Whichever boxes the user has pinned down. Both of a mode's may be set; the two
 * modes are not mixed, because the widget only ever shows one pair at a time.
 */
export interface DynamicInputLocks {
    distance?: number;
    angle?: number;
    dx?: number;
    dy?: number;
}

/**
 * What the widget at the cursor is given on every mouse move: the live readings,
 * which pair of them to show, which are pinned, and the two ways back into the pick.
 * Handing the callbacks over with the state (the way `showInput` does) keeps the
 * widget from needing to know anything about handlers, documents or views.
 */
export interface DynamicInputState {
    reading: DynamicInputReading;
    mode: DynamicInputMode;
    locks: DynamicInputLocks;
    /** Pin or release a box without committing the point. */
    setLocks: (locks: DynamicInputLocks) => void;
    /** Finish the pick at whatever these locks describe. */
    commit: (locks: DynamicInputLocks) => void;
}

/**
 * Where the distance box sits while a segment is being dragged out: the two ends of
 * the dimension guide, in world space.
 *
 * The box rides the dimension line rather than the crosshair, the way AutoCAD's does -
 * the length belongs beside the geometry it measures, and leaving it at the cursor
 * puts it on top of whatever the line is being drawn against. World points rather than
 * screen ones so the box can re-project itself and stay on the line as the view moves.
 */
export interface DimensionAnchor {
    start: XYZ;
    end: XYZ;
}

/**
 * Where each of the dynamic input boxes goes.
 *
 * A polar prompt has one dimension to sit on - the segment's own length - and the angle
 * stays at the crosshair. A cartesian one has two, the rectangle's width and its height,
 * and each box belongs on the side it measures. Either may be absent when that side has
 * no length yet, and the box then waits at the crosshair.
 */
export interface DimensionAnchors {
    first?: DimensionAnchor;
    second?: DimensionAnchor;
}

/**
 * The dimension guide: the segment shifted sideways by `gap`, to be drawn parallel to
 * the line being measured with the length written on it.
 *
 * The shift is perpendicular to the segment within the plane, and always the same way
 * round that perpendicular, so the guide keeps to one side of the direction of travel
 * rather than flipping across the line as the cursor swings past an axis. `gap` is a
 * world distance; the caller scales a pixel gap by worldUnitsPerPixel to keep it the
 * same on screen at every zoom.
 *
 * A segment with no length has no perpendicular to offset along, so it gets no guide.
 */
export function dimensionGuideLine(start: XYZ, end: XYZ, plane: Plane, gap: number): [XYZ, XYZ] | undefined {
    const direction = end.sub(start).normalize();
    if (!direction) return undefined;

    const offset = plane.normal.cross(direction).normalize();
    if (!offset) return undefined;

    const shift = offset.multiply(gap);
    return [start.add(shift), end.add(shift)];
}

/**
 * The guide line plus the short ticks that tie its ends back to the line being
 * measured, as a list of segments to draw.
 *
 * Without the ticks the guide reads as an unrelated second line that happens to be
 * nearby; closing the ends is what makes the pair read as one dimension, the way it
 * does on a finished drawing. The ticks run the whole gap, from the real line's
 * endpoints out to the guide's, so there is nothing between the two to fall through.
 */
export function dimensionGuideSegments(
    start: XYZ,
    end: XYZ,
    plane: Plane,
    gap: number,
): [XYZ, XYZ][] | undefined {
    const guide = dimensionGuideLine(start, end, plane, gap);
    if (!guide) return undefined;

    return [guide, [start, guide[0]], [end, guide[1]]];
}

/**
 * The two sides of the rectangle `refPoint` and `corner` span, each as its own
 * dimension: the width along the plane's x axis and the height along its y.
 *
 * A rectangle is answered as two lengths along the axes rather than as a distance at an
 * angle - `@10,6` - so one dimension line across the diagonal would be measuring
 * something nobody typed. These are the two the boxes hold.
 *
 * Each runs outwards from the corner it belongs to, so the pair meet at `refPoint` and
 * frame the rectangle rather than crossing it. A side of no length gets no dimension:
 * there is nothing to measure and nowhere to hang the figure.
 */
export function rectDimensionAnchors(
    refPoint: XYZ,
    corner: XYZ,
    plane: Plane,
): { width?: [XYZ, XYZ]; height?: [XYZ, XYZ] } {
    const { dx, dy } = cartesianOf(refPoint, corner, plane);
    // The two other corners of the rectangle, which are where each side ends.
    const alongX = refPoint.add(plane.xvec.multiply(dx));
    const alongY = refPoint.add(plane.yvec.multiply(dy));

    return {
        width: Math.abs(dx) > 0 ? [refPoint, alongX] : undefined,
        height: Math.abs(dy) > 0 ? [refPoint, alongY] : undefined,
    };
}

/** Segments in a full turn of the protractor arc - its smoothness at any sweep. */
const PROTRACTOR_STEPS = 72;

/**
 * How near the zero direction a line counts as lying along it, in degrees. Below this
 * the protractor has nothing to show that the line is not already showing.
 */
const COLLINEAR_TOLERANCE = 0.5;

/**
 * The protractor: the arc swept at `center` from the plane's zero direction round to
 * the line being drawn, as a polyline, plus the zero leg it is measured against.
 *
 * It is the hint that makes an angle legible while it is still being chosen - the
 * figure in the box says 140, and this says which 140, from where, and which way
 * round. The two legs of the angle are the line itself and the zero direction, so only
 * the zero leg is drawn: the other is already on screen, and drawing it again would
 * lay a second line over the one being dragged.
 *
 * `radius` is a world distance. The caller takes it from the segment's own length, so
 * the arc reaches out towards the cursor the way a protractor laid on the drawing
 * would - a fixed screen radius stays a tidy badge near the start point but stops
 * reading as a measurement of *this* line once the line is long.
 *
 * A line lying along the zero direction, either way round, gets nothing at all: there
 * is no turn to describe, and the leg alone would be a stray line down the geometry.
 */
export function protractorSegments(
    center: XYZ,
    angle: number,
    plane: Plane,
    radius: number,
    steps: number = PROTRACTOR_STEPS,
): [XYZ, XYZ][] {
    const sweep = normalizeAngle(angle);
    if (radius <= 0) return [];

    // A line already lying along the zero direction has turned through nothing, and a
    // protractor for it would be the zero leg drawn straight down the line itself -
    // clutter on top of the geometry rather than a hint about it. The same goes for a
    // half turn, where the leg runs back along the line the other way. Both are exactly
    // what ORTHO produces, so this is the common case, not a corner one.
    //
    // Compared with a tolerance rather than exactly: an angle derived from a cursor
    // position is rarely a whole number, and 359.9999 is collinear by eye whatever it
    // is arithmetically.
    if (sweep < COLLINEAR_TOLERANCE) return [];
    if (Math.abs(sweep - 180) < COLLINEAR_TOLERANCE) return [];
    if (sweep > 360 - COLLINEAR_TOLERANCE) return [];

    const zeroLeg: [XYZ, XYZ] = [center, pointFromPolar(center, radius, 0, plane)];
    const segments: [XYZ, XYZ][] = [zeroLeg];
    // Enough steps that the arc reads as curved at any sweep, without emitting a
    // segment per degree for a turn of two.
    const count = Math.max(2, Math.ceil((steps * sweep) / 360));
    let previous = zeroLeg[1];
    for (let i = 1; i <= count; i++) {
        const next = pointFromPolar(center, radius, (sweep * i) / count, plane);
        segments.push([previous, next]);
        previous = next;
    }
    return segments;
}

/** Degrees into [0, 360), so 361 reads as 1 and -90 as 270 - AutoCAD's convention. */
export function normalizeAngle(degrees: number): number {
    const wrapped = degrees % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * How far and in what direction `point` lies from `refPoint`, measured in the
 * plane. A point on the reference point itself has no direction, so its angle
 * reads 0 rather than being left undefined - the caller is about to show it in a
 * box, and there is nothing better to show.
 */
export function polarOf(refPoint: XYZ, point: XYZ, plane: Plane): PolarReading {
    const vector = point.sub(refPoint);
    const x = vector.dot(plane.xvec);
    const y = vector.dot(plane.yvec);
    return {
        distance: Math.sqrt(x * x + y * y),
        angle: normalizeAngle(MathUtils.radToDeg(Math.atan2(y, x))),
    };
}

/** How far `point` lies from `refPoint` along each of the plane's own axes. */
export function cartesianOf(refPoint: XYZ, point: XYZ, plane: Plane): CartesianReading {
    const vector = point.sub(refPoint);
    return { dx: vector.dot(plane.xvec), dy: vector.dot(plane.yvec) };
}

/** Both readings of the same offset - what the widget is handed on every move. */
export function readingOf(refPoint: XYZ, point: XYZ, plane: Plane): DynamicInputReading {
    return { ...polarOf(refPoint, point, plane), ...cartesianOf(refPoint, point, plane) };
}

/** The point `distance` away from `refPoint` at `angle`, in the plane. */
export function pointFromPolar(refPoint: XYZ, distance: number, angle: number, plane: Plane): XYZ {
    const radians = MathUtils.degToRad(angle);
    return refPoint
        .add(plane.xvec.multiply(distance * Math.cos(radians)))
        .add(plane.yvec.multiply(distance * Math.sin(radians)));
}

/** The point `dx`, `dy` from `refPoint` along the plane's axes - AutoCAD's `@10,6`. */
export function pointFromCartesian(refPoint: XYZ, dx: number, dy: number, plane: Plane): XYZ {
    return refPoint.add(plane.xvec.multiply(dx)).add(plane.yvec.multiply(dy));
}

/**
 * Where the point actually goes: the locked readings win, and anything unlocked is
 * taken from wherever the cursor currently is. With nothing locked this returns the
 * cursor's own position projected onto the plane, so a pick that never touches the
 * boxes behaves exactly as it did before dynamic input existed.
 *
 * A cartesian lock decides the whole answer when there is one, rather than being
 * combined with a polar one: the widget shows one pair of boxes at a time, so the
 * two kinds only ever arrive together if a mode changed mid-pick - and then the pair
 * the user is actually looking at is the pair to obey.
 */
export function applyDynamicLocks(refPoint: XYZ, cursor: XYZ, locks: DynamicInputLocks, plane: Plane): XYZ {
    if (!hasAnyLock(locks)) {
        return plane.project(cursor);
    }

    if (locks.dx !== undefined || locks.dy !== undefined) {
        const current = cartesianOf(refPoint, cursor, plane);
        return pointFromCartesian(refPoint, locks.dx ?? current.dx, locks.dy ?? current.dy, plane);
    }

    const current = polarOf(refPoint, cursor, plane);
    return pointFromPolar(refPoint, locks.distance ?? current.distance, locks.angle ?? current.angle, plane);
}

export function hasAnyLock(locks: DynamicInputLocks): boolean {
    return (
        locks.distance !== undefined ||
        locks.angle !== undefined ||
        locks.dx !== undefined ||
        locks.dy !== undefined
    );
}
