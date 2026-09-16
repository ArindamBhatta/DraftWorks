// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Snap mode (F9) is rounding, and rounding has exactly two ways to go badly wrong: a
// spacing of zero, which divides by zero and puts every point at the origin, and rounding
// in world coordinates rather than the plane's, which lands the lattice on the wrong axes
// the moment the workplane is not the world XY.

import { expect, test } from "@rstest/core";
import { Config } from "../../config";
import { Plane, Ray, XYZ } from "../../math";
import type { IView } from "../../visual";
import { GridSnap } from "./gridSnap";

/** Screen pixels per drawing unit in the fake view. */
const SCALE = 10;

function createView(workplane = Plane.XY): IView {
    return {
        workplane,
        // Looking straight down at the drawing plane. ViewUtils.ensurePlane asks for
        // these to decide whether the plane is edge-on to the camera; here it never is.
        direction: () => XYZ.unitZ.reverse(),
        up: () => XYZ.unitY,
        rayAt: (x: number, y: number) =>
            new Ray({
                point: new XYZ({ x: x / SCALE, y: -y / SCALE, z: 0 }),
                direction: XYZ.unitZ.reverse(),
            }),
    } as unknown as IView;
}

/** The point snap mode lands on for a cursor at the given drawing coordinates. */
function snapAt(x: number, y: number, view = createView()) {
    const snap = new GridSnap();
    return snap.snap({ view, mx: x * SCALE, my: -y * SCALE, shapes: [] } as never)?.point;
}

/** Runs `body` with snap mode forced to a known state, then puts it back. */
function withSnapMode(settings: { on?: boolean; spacing?: number }, body: () => void) {
    const previous = { on: Config.instance.enableGridSnap, spacing: Config.instance.snapSpacing };
    try {
        Config.instance.enableGridSnap = settings.on ?? true;
        Config.instance.snapSpacing = settings.spacing ?? 10;
        body();
    } finally {
        Config.instance.enableGridSnap = previous.on;
        Config.instance.snapSpacing = previous.spacing;
    }
}

test("off by default, so nothing changes until the mode is asked for", () => {
    withSnapMode({ on: false }, () => {
        expect(snapAt(13, 27)).toBeUndefined();
    });
});

test("a point is pulled to the nearest multiple of the spacing", () => {
    withSnapMode({ spacing: 10 }, () => {
        const point = snapAt(13, 27);
        expect(point!.x).toBeCloseTo(10, 6);
        expect(point!.y).toBeCloseTo(30, 6);
    });
});

test("rounding goes to the nearest step, not always down", () => {
    withSnapMode({ spacing: 10 }, () => {
        expect(snapAt(4, 0)!.x).toBeCloseTo(0, 6);
        expect(snapAt(6, 0)!.x).toBeCloseTo(10, 6);
        // Negatives round the same way rather than truncating toward zero.
        expect(snapAt(-4, 0)!.x).toBeCloseTo(-0, 6);
        expect(snapAt(-6, 0)!.x).toBeCloseTo(-10, 6);
    });
});

test("the spacing is honoured, not assumed", () => {
    withSnapMode({ spacing: 0.5 }, () => {
        expect(snapAt(1.3, 0)!.x).toBeCloseTo(1.5, 6);
    });
    withSnapMode({ spacing: 25 }, () => {
        expect(snapAt(30, 0)!.x).toBeCloseTo(25, 6);
        expect(snapAt(40, 0)!.x).toBeCloseTo(50, 6);
    });
});

test("a point already on the lattice is left where it is", () => {
    withSnapMode({ spacing: 10 }, () => {
        const point = snapAt(20, 30);
        expect(point!.x).toBeCloseTo(20, 6);
        expect(point!.y).toBeCloseTo(30, 6);
    });
});

test("a spacing of zero or less is refused rather than dividing by it", () => {
    // Config is what guards this: a rejected value leaves the previous spacing in place,
    // so the lattice never collapses onto the origin.
    withSnapMode({ spacing: 10 }, () => {
        Config.instance.snapSpacing = 0;
        expect(Config.instance.snapSpacing).toBe(10);

        Config.instance.snapSpacing = -5;
        expect(Config.instance.snapSpacing).toBe(10);

        Config.instance.snapSpacing = Number.NaN;
        expect(Config.instance.snapSpacing).toBe(10);
    });
});

test("the lattice follows the workplane's axes and origin, not the world's", () => {
    // A plane shifted by half a step: the lattice must move with it, so a point that was
    // on a node before is now mid-cell. Rounding in world coordinates would miss this.
    const shifted = new Plane({
        origin: new XYZ({ x: 5, y: 0, z: 0 }),
        normal: XYZ.unitZ,
        xvec: XYZ.unitX,
    });
    withSnapMode({ spacing: 10 }, () => {
        expect(snapAt(15, 0, createView(shifted))!.x).toBeCloseTo(15, 6);
        expect(snapAt(13, 0, createView(shifted))!.x).toBeCloseTo(15, 6);
    });
});
