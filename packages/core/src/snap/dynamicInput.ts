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
