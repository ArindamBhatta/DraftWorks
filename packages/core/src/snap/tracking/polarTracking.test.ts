// The reported bug, as a test: polar tracking was never offered, because TrackingSnap
// asked AxisTracking for its axes without an angle - which only ever builds the four
// workplane axes - and gated the whole snap behind the object-snap-tracking flag. So
// these cover the two things that were wrong: that an off-axis polar angle produces a
// snap at all, and that each mode answers to its own toggle.

import { expect, test } from "@rstest/core";
import { Config } from "../../config";
import { I18n } from "../../i18n";
import { Plane, Ray, XY, XYZ } from "../../math";
import type { IView } from "../../visual";
import { TrackingSnap } from "./trackingSnap";

// The translations live in @draftworks/i18n, which depends on this package rather than
// the other way round, so a core test registers the few strings it asserts on itself.
I18n.addLanguage({
    display: "English",
    language: "en",
    translation: { "snap.polarAt{0}": "Polar: {0}°" },
} as never);

/** Screen pixels per drawing unit in the fake view below. */
const SCALE = 10;

/**
 * A plan view with a straight orthographic projection: x right, y up, z ignored. Enough
 * for the tracking maths, which only ever asks where a world point lands on screen and
 * what ray a pixel casts.
 */
function createView(): IView {
    const meshes = new Map<number, unknown>();
    let nextId = 1;

    return {
        workplane: Plane.XY,
        worldToScreen: (p: XYZ) => new XY({ x: p.x * SCALE, y: -p.y * SCALE }),
        rayAt: (x: number, y: number) =>
            new Ray({
                point: new XYZ({ x: x / SCALE, y: -y / SCALE, z: 0 }),
                // Straight into the plane, so the ray meets the workplane exactly under
                // the pixel asked about.
                direction: XYZ.unitZ.reverse(),
            }),
        document: {
            visual: {
                context: {
                    displayMesh: () => {
                        const id = nextId++;
                        meshes.set(id, true);
                        return id;
                    },
                    removeMesh: (id: number) => meshes.delete(id),
                },
            },
        },
    } as unknown as IView;
}

const origin = XYZ.zero;

/** Where the cursor would be, in pixels, at `distance` units along `degrees` from origin. */
function screenAt(degrees: number, distance: number): [number, number] {
    const radians = (degrees / 180) * Math.PI;
    return [Math.cos(radians) * distance * SCALE, -Math.sin(radians) * distance * SCALE];
}

function snapAt(degrees: number, distance = 5) {
    const view = createView();
    const snap = new TrackingSnap(() => origin, false);
    const [mx, my] = screenAt(degrees, distance);
    try {
        return snap.snap({ view, mx, my, shapes: [] } as never);
    } finally {
        snap.clear();
    }
}

/** Runs `body` with the drafting aids forced to a known state, then puts them back. */
function withConfig(
    settings: { polar?: boolean; tracking?: boolean; angle?: number; angles?: number[] },
    body: () => void,
) {
    const previous = {
        polar: Config.instance.enablePolarTracking,
        tracking: Config.instance.enableSnapTracking,
        angles: Config.instance.polarAngles,
    };
    try {
        Config.instance.enablePolarTracking = settings.polar ?? true;
        Config.instance.enableSnapTracking = settings.tracking ?? true;
        Config.instance.polarAngles = settings.angles ?? (settings.angle ? [settings.angle] : [90]);
        body();
    } finally {
        Config.instance.enablePolarTracking = previous.polar;
        Config.instance.enableSnapTracking = previous.tracking;
        Config.instance.polarAngles = previous.angles;
    }
}

test("a cursor on the 45 degree ray snaps to it once the increment allows 45", () => {
    // The bug, exactly: at the default 90 there is no 45° ray to catch the cursor, and
    // before this change there was no way to ask for one.
    withConfig({ angle: 90 }, () => {
        expect(snapAt(45)).toBeUndefined();
    });

    withConfig({ angle: 45 }, () => {
        const result = snapAt(45);
        expect(result).toBeDefined();
        expect(result!.info).toContain("45");
        // On the ray means on the diagonal, not merely near it.
        expect(result!.point!.x).toBeCloseTo(result!.point!.y, 6);
    });
});

test("the snapped point lies on the polar ray, not under the cursor", () => {
    withConfig({ angle: 30 }, () => {
        // A degree off the 30° ray: close enough to be caught, and the result must be
        // pulled onto the ray rather than left where the pointer was.
        const result = snapAt(31);
        expect(result).toBeDefined();
        const angle = (Math.atan2(result!.point!.y, result!.point!.x) * 180) / Math.PI;
        expect(angle).toBeCloseTo(30, 4);
    });
});

test("a cursor well off every ray is not snapped", () => {
    withConfig({ angle: 90 }, () => {
        expect(snapAt(45)).toBeUndefined();
    });
    withConfig({ angle: 45 }, () => {
        // Half way between the 0° and 45° rays, far enough out that neither is within
        // the 10px catch radius.
        expect(snapAt(22.5, 20)).toBeUndefined();
    });
});

test("polar tracking answers to its own toggle, not to object snap tracking's", () => {
    // These shared one flag before, which is why turning tracking off took the axis
    // alignment with it and why there was nothing for a POLAR button to switch.
    withConfig({ angle: 45, polar: false, tracking: true }, () => {
        expect(snapAt(45)).toBeUndefined();
    });

    withConfig({ angle: 45, polar: true, tracking: false }, () => {
        expect(snapAt(45)).toBeDefined();
    });
});

test("with both tracking modes off the snap does nothing at all", () => {
    withConfig({ angle: 45, polar: false, tracking: false }, () => {
        expect(snapAt(45)).toBeUndefined();
        expect(snapAt(0)).toBeUndefined();
    });
});

test("several increments at once track every angle either of them offers", () => {
    // 90 and 60 together: the axes and the sixths, which no single increment gives.
    withConfig({ angles: [90, 60] }, () => {
        expect(snapAt(90)).toBeDefined();
        expect(snapAt(60)).toBeDefined();
        expect(snapAt(120)).toBeDefined();
        // 45 belongs to neither family, so it is still not offered.
        expect(snapAt(45)).toBeUndefined();
    });
});

test("a ray shared by two increments is still a single alignment, not an intersection", () => {
    // 90 lies in both the 90 and 45 families. If it were added twice, TrackingSnap would
    // see two hits and try to intersect two identical rays instead of tracking along one.
    withConfig({ angles: [90, 45] }, () => {
        const result = snapAt(90);
        expect(result).toBeDefined();
        expect(result!.info).toContain("90");
        expect(result!.point!.x).toBeCloseTo(0, 6);
        expect(result!.point!.y).toBeCloseTo(5, 6);
    });
});

test("the axes still track when polar is left at its default increment", () => {
    // Whatever else changes, horizontal and vertical must keep working - that is the
    // behaviour every existing drawing was made with.
    withConfig({ angle: 90 }, () => {
        expect(snapAt(0)).toBeDefined();
        expect(snapAt(90)).toBeDefined();
        expect(snapAt(180)).toBeDefined();
        expect(snapAt(270)).toBeDefined();
    });
});
