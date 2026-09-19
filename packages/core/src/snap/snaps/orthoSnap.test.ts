// ORTHO draws a dashed line along whichever axis it locked the point to, and that axis
// changes under the cursor - crossing the diagonal swaps X for Y. Each of those lines is
// a mesh the snap owns and has to take back down; the one failure mode that shows on
// screen is a line drawn and then never removed, leaving the old axis lit beside the new.
//
// The other half of the mode is that it constrains the direction without swallowing the
// object snaps: a point that is already on the locked axis has to come back with its own
// identity - endpoint, midpoint - rather than being flattened into a bare axis point.

import { expect, test } from "@rstest/core";
import { Config } from "../../config";
import { Plane, Ray, XYZ } from "../../math";
import type { IView } from "../../visual";
import type { ISnap, SnapResult } from "../snap";
import { OrthoSnap } from "./orthoSnap";

/** Screen pixels per drawing unit in the fake view. */
const SCALE = 10;

/** Records every mesh the snap puts up and takes down, so leaks are visible. */
function createView() {
    const live = new Set<number>();
    let next = 1;

    const view = {
        workplane: Plane.XY,
        direction: () => XYZ.unitZ.reverse(),
        up: () => XYZ.unitY,
        screenToWorld: (x: number, y: number) => new XYZ({ x: x / SCALE, y: -y / SCALE, z: 0 }),
        rayAt: (x: number, y: number) =>
            new Ray({
                point: new XYZ({ x: x / SCALE, y: -y / SCALE, z: 0 }),
                direction: XYZ.unitZ.reverse(),
            }),
        document: {
            visual: {
                context: {
                    displayMesh: () => {
                        const id = next++;
                        live.add(id);
                        return id;
                    },
                    removeMesh: (id: number) => live.delete(id),
                },
            },
        },
    } as unknown as IView;

    return { view, live };
}

/** Runs `body` with ORTHO forced on, then puts the setting back. */
function withOrtho(body: () => void) {
    const previous = Config.instance.enableOrtho;
    try {
        Config.instance.enableOrtho = true;
        body();
    } finally {
        Config.instance.enableOrtho = previous;
    }
}

const moveTo = (snap: OrthoSnap, view: IView, x: number, y: number) =>
    snap.snap({ view, mx: x * SCALE, my: -y * SCALE, shapes: [] } as never);

test("the point is locked to whichever axis the cursor has travelled furthest along", () => {
    withOrtho(() => {
        const { view } = createView();
        const snap = new OrthoSnap(() => XYZ.zero);

        expect(moveTo(snap, view, 100, 5)?.point).toEqual(new XYZ({ x: 100, y: 0, z: 0 }));
        expect(moveTo(snap, view, -100, 5)?.point).toEqual(new XYZ({ x: -100, y: 0, z: 0 }));
        expect(moveTo(snap, view, 5, 100)?.point).toEqual(new XYZ({ x: 0, y: 100, z: 0 }));
        expect(moveTo(snap, view, 5, -100)?.point).toEqual(new XYZ({ x: 0, y: -100, z: 0 }));
    });
});

// The regression: dragging vertically used to leave the horizontal line from the frames
// before the cursor crossed the diagonal still on screen, so the segment read as 90° while
// a stale X axis sat under it.
test("swapping axis under the cursor leaves only one line on screen", () => {
    withOrtho(() => {
        const { view, live } = createView();
        const snap = new OrthoSnap(() => XYZ.zero);

        moveTo(snap, view, 100, 5); // along X
        moveTo(snap, view, 5, 100); // now along Y
        moveTo(snap, view, 5, 200); // still along Y

        expect(live.size).toBe(1);
    });
});

test("a snap that is drawn but never removed by the handler still cleans up on the next move", () => {
    withOrtho(() => {
        const { view, live } = createView();
        const snap = new OrthoSnap(() => XYZ.zero);

        // Ten moves with no removeDynamicObject between them - what happens when the
        // handler's own teardown is skipped because another snap won the point.
        for (let i = 1; i <= 10; i++) moveTo(snap, view, 5, 10 * i);

        expect(live.size).toBe(1);
    });
});

test("clearing the snap takes its line down", () => {
    withOrtho(() => {
        const { view, live } = createView();
        const snap = new OrthoSnap(() => XYZ.zero);

        moveTo(snap, view, 100, 5);
        snap.clear();

        expect(live.size).toBe(0);
    });
});

test("with no reference point there is nothing to measure from, so nothing is drawn", () => {
    withOrtho(() => {
        const { view, live } = createView();
        const snap = new OrthoSnap(() => undefined);

        expect(moveTo(snap, view, 100, 5)).toBeUndefined();
        expect(live.size).toBe(0);
    });
});

// ---------------------------------------------------------------- ortho + object snap

/** A stand-in object snap that always answers with the one point it was built on. */
function fakeSnap(point: XYZ | undefined, info: string, view: IView): ISnap & { removed: number } {
    const snap = {
        removed: 0,
        snap: (): SnapResult | undefined =>
            point ? { view, point, info, shapes: [], type: "end" } : undefined,
        removeDynamicObject: () => {
            snap.removed++;
        },
        clear: () => {},
    };
    return snap;
}

// The regression this pairs with: while ORTHO was on, OrthoSnap won the handler's snap
// loop outright and the object snaps behind it never ran, so an endpoint sitting on the
// locked axis lost its marker and its "End ->" tip.
test("an object snap on the locked axis is taken, keeping its own identity", () => {
    withOrtho(() => {
        const { view } = createView();
        // Directly above the reference point, so it is on the Y axis the cursor picks.
        const endpoint = new XYZ({ x: 0, y: 400, z: 0 });
        const osnap = fakeSnap(endpoint, "End", view);
        const snap = new OrthoSnap(() => XYZ.zero, undefined, [osnap]);

        const result = moveTo(snap, view, 3, 390);

        expect(result?.point).toEqual(endpoint);
        expect(result?.type).toBe("end");
        expect(result?.info).toContain("End");
        // Measured from the reference point, so the boxes read the segment's length.
        expect(result?.distance).toBeCloseTo(400);
    });
});

test("an object snap off the locked axis is ignored, so the point stays straight", () => {
    withOrtho(() => {
        const { view } = createView();
        // Well off the Y axis - taking it would bend the segment away from vertical.
        const osnap = fakeSnap(new XYZ({ x: 60, y: 400, z: 0 }), "End", view);
        const snap = new OrthoSnap(() => XYZ.zero, undefined, [osnap]);

        const result = moveTo(snap, view, 3, 390);

        expect(result?.point).toEqual(new XYZ({ x: 0, y: 390, z: 0 }));
        expect(result?.type).toBe("axis");
    });
});

test("a candidate that is not taken has its markers removed", () => {
    withOrtho(() => {
        const { view } = createView();
        const offAxis = fakeSnap(new XYZ({ x: 60, y: 400, z: 0 }), "End", view);
        const snap = new OrthoSnap(() => XYZ.zero, undefined, [offAxis]);

        moveTo(snap, view, 3, 390);

        expect(offAxis.removed).toBe(1);
    });
});

test("the alignment path is drawn whether or not an object snap won", () => {
    withOrtho(() => {
        const { view, live } = createView();
        const osnap = fakeSnap(new XYZ({ x: 0, y: 400, z: 0 }), "End", view);
        const snap = new OrthoSnap(() => XYZ.zero, undefined, [osnap]);

        moveTo(snap, view, 3, 390);

        expect(live.size).toBe(1);
    });
});

test("ortho off leaves the candidates to answer for themselves", () => {
    const previous = Config.instance.enableOrtho;
    try {
        Config.instance.enableOrtho = false;
        const { view } = createView();
        const osnap = fakeSnap(new XYZ({ x: 0, y: 400, z: 0 }), "End", view);
        const snap = new OrthoSnap(() => XYZ.zero, undefined, [osnap]);

        // Ortho declines entirely, so the handler falls through to the real snaps.
        expect(moveTo(snap, view, 3, 390)).toBeUndefined();
    } finally {
        Config.instance.enableOrtho = previous;
    }
});
