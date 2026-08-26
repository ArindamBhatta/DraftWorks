// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MathUtils, type Plane, type XYZ } from "../math";

/**
 * AutoCAD's dynamic input, expressed as pure geometry.
 *
 * While a point is being picked with something to measure from, the cursor carries
 * two live readings - how far and at what angle from the reference point. Typing
 * into one locks it, and the other keeps following the mouse: lock the distance and
 * the point rides a circle, lock the angle and it rides a ray. Locking both fixes
 * the point outright, which is how `10` Tab `45` Enter draws an exact segment
 * without ever touching the command line.
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

/** Whichever of the two readings the user has pinned down. Both may be set. */
export interface DynamicInputLocks {
    distance?: number;
    angle?: number;
}

/**
 * What the widget at the cursor is given on every mouse move: the live readings,
 * which of them are pinned, and the two ways back into the pick. Handing the
 * callbacks over with the state (the way `showInput` does) keeps the widget from
 * needing to know anything about handlers, documents or views.
 */
export interface DynamicInputState {
    reading: PolarReading;
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

/** The point `distance` away from `refPoint` at `angle`, in the plane. */
export function pointFromPolar(refPoint: XYZ, distance: number, angle: number, plane: Plane): XYZ {
    const radians = MathUtils.degToRad(angle);
    return refPoint
        .add(plane.xvec.multiply(distance * Math.cos(radians)))
        .add(plane.yvec.multiply(distance * Math.sin(radians)));
}

/**
 * Where the point actually goes: the locked readings win, and anything unlocked is
 * taken from wherever the cursor currently is. With nothing locked this returns the
 * cursor's own position projected onto the plane, so a pick that never touches the
 * boxes behaves exactly as it did before dynamic input existed.
 */
export function applyDynamicLocks(refPoint: XYZ, cursor: XYZ, locks: DynamicInputLocks, plane: Plane): XYZ {
    if (locks.distance === undefined && locks.angle === undefined) {
        return plane.project(cursor);
    }

    const current = polarOf(refPoint, cursor, plane);
    return pointFromPolar(refPoint, locks.distance ?? current.distance, locks.angle ?? current.angle, plane);
}

export function hasAnyLock(locks: DynamicInputLocks): boolean {
    return locks.distance !== undefined || locks.angle !== undefined;
}
