// Polar tracking is the angle increment made into rays. The cases that matter are the
// ones where a bad increment does not merely give the wrong answer: `initAxes` walks
// `while (testAngle < 360) testAngle += angle`, so a zero or negative step hangs the tab
// on the next mouse move, which is the worst failure this file can have.

import { expect, test } from "@rstest/core";
import { Config } from "../../config";
import { I18n } from "../../i18n";
import { Plane, XYZ } from "../../math";
import type { IView } from "../../visual";
import { AxisTracking } from "./axisTracking";

// The translations live in @draftworks/i18n, which depends on this package rather than
// the other way round, so a core test registers the few strings it asserts on itself.
I18n.addLanguage({
    display: "English",
    language: "en",
    translation: { "snap.polarAt{0}": "Polar: {0}°", "axis.z": "Z" },
} as never);

const view = { workplane: Plane.XY } as unknown as IView;
const origin = XYZ.zero;

/** A fresh tracker each time - the axes are cached per view after the first call. */
const axesAt = (angles: number[] | undefined, trackingZ = false) =>
    new AxisTracking(trackingZ).getAxes(view, origin, angles);

test("no angles given is the plain workplane axes, as before polar tracking existed", () => {
    expect(axesAt(undefined).length).toBe(4);
    expect(axesAt([]).length).toBe(4);
});

test("90 degrees reproduces those same four axes", () => {
    // This is the default, so turning polar tracking on must not change what a drawing
    // snaps to until the increment is actually moved off 90.
    const axes = axesAt([90]);
    expect(axes.length).toBe(4);
    expect(axes.some((a) => a.direction.isEqualTo(XYZ.unitX))).toBe(true);
    expect(axes.some((a) => a.direction.isEqualTo(XYZ.unitY))).toBe(true);
    expect(axes.some((a) => a.direction.isEqualTo(XYZ.unitX.reverse()))).toBe(true);
    expect(axes.some((a) => a.direction.isEqualTo(XYZ.unitY.reverse()))).toBe(true);
});

test("smaller increments divide the full circle", () => {
    expect(axesAt([45]).length).toBe(8);
    expect(axesAt([30]).length).toBe(12);
    expect(axesAt([15]).length).toBe(24);
    expect(axesAt([22.5]).length).toBe(16);
});

test("several increments are offered together, without duplicating shared rays", () => {
    // 90 and 60 is the case that earns the list: neither divides the other, so the union
    // is eight directions that no single increment can produce.
    expect(axesAt([90, 60]).length).toBe(8);

    // 45 already contains every multiple of 90, so ticking both must give 45's eight
    // rays and not twelve - a repeated ray is a second tracking hit in the same place,
    // which TrackingSnap would read as an intersection to snap to.
    expect(axesAt([90, 45]).length).toBe(8);
    expect(axesAt([90, 45, 15]).length).toBe(24);
});

test("float error in an increment does not split one ray into two", () => {
    // 22.5 accumulates error as it is added up; rounding before deduplication is what
    // keeps 90° from appearing twice, a hair apart.
    const axes = axesAt([22.5, 90]);
    expect(axes.length).toBe(16);
});

test("every ray starts at the reference point", () => {
    // Polar angles are measured from the point the command is drawing from, not from the
    // origin - a ray anchored anywhere else aligns to the wrong place entirely.
    const point = new XYZ({ x: 37, y: -11, z: 0 });
    const axes = new AxisTracking(false).getAxes(view, point, [45]);
    expect(axes.every((a) => a.point.isEqualTo(point))).toBe(true);
});

test("a 45 degree increment offers the diagonals", () => {
    const axes = axesAt([45]);
    const diagonal = new XYZ({ x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 });
    expect(axes.some((a) => a.direction.isEqualTo(diagonal))).toBe(true);
});

test("an unusable increment falls back to the axes instead of looping forever", () => {
    // The guard this is here for: `for (; testAngle < 360; testAngle += step)` never
    // terminates at zero or below, and would take the whole tab with it.
    for (const angle of [0, -15, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(axesAt([angle]).length).toBe(4);
    }
    // A bad one alongside a good one drops only the bad one.
    expect(axesAt([0, 45]).length).toBe(8);
});

test("tracking Z adds the two normal rays on top of the polar ones", () => {
    expect(axesAt([45], true).length).toBe(10);
    expect(axesAt(undefined, true).length).toBe(6);
});

test("rays are labelled by their angle, so a hit reads as polar rather than as an axis", () => {
    // Ortho forces a point onto an axis; polar only offers the alignment. The tooltip is
    // the only thing that tells the two apart on screen.
    const names = axesAt([45]).map((a) => a.name);
    expect(names).toContain("Polar: 0°");
    expect(names).toContain("Polar: 45°");
    expect(names).toContain("Polar: 315°");
});

test("the configured polar angles are cleaned up into something that terminates", () => {
    const original = Config.instance.polarAngles;
    try {
        Config.instance.polarAngles = [0];
        expect(Config.instance.polarAngles).toEqual([1]);

        Config.instance.polarAngles = [-30];
        expect(Config.instance.polarAngles).toEqual([1]);

        // Above 90 there is no increment that still crosses both axes, so 90 is the top.
        Config.instance.polarAngles = [360];
        expect(Config.instance.polarAngles).toEqual([90]);

        // Deduplicated and ordered, so the button's label is stable however they arrived.
        Config.instance.polarAngles = [45, 90, 45];
        expect(Config.instance.polarAngles).toEqual([90, 45]);

        // Polar tracking with no angles is a mode that cannot do anything, so the last
        // one cannot be unticked away.
        Config.instance.polarAngles = [];
        expect(Config.instance.polarAngles).toEqual([90]);
    } finally {
        Config.instance.polarAngles = original;
    }
});

test("ortho and polar are mutually exclusive, whichever is switched on", () => {
    const previous = { ortho: Config.instance.enableOrtho, polar: Config.instance.enablePolarTracking };
    try {
        // Ortho forces the point onto an axis, so no polar ray could ever be offered
        // while it is on - both lit would mean a POLAR button that does nothing.
        Config.instance.enablePolarTracking = true;
        Config.instance.enableOrtho = true;
        expect(Config.instance.enablePolarTracking).toBe(false);

        Config.instance.enablePolarTracking = true;
        expect(Config.instance.enableOrtho).toBe(false);

        // Switching one off leaves the other alone - that asymmetry is also what stops
        // the two setters calling each other forever.
        Config.instance.enablePolarTracking = false;
        expect(Config.instance.enableOrtho).toBe(false);
    } finally {
        Config.instance.enableOrtho = previous.ortho;
        Config.instance.enablePolarTracking = previous.polar;
    }
});
