// What counts as still hovering the same point. Acquisition is a timer that has to
// survive the pointer moves a hovering hand makes - get this wrong and the hover never
// completes, so no alignment path is ever offered and the feature looks absent rather
// than broken.

import { expect, test } from "@rstest/core";
import { XYZ } from "../../math";
import type { SnapResult, SnapType } from "../snap";
import { isSameTrackingTarget } from "./objectTracking";

const at = (x: number, y: number, type: SnapType = "end") =>
    ({ point: new XYZ({ x, y, z: 0 }), type, shapes: [] }) as unknown as SnapResult;

test("the same key point across two moves is one hover, however fresh the snap object", () => {
    // Every pointer move builds a new SnapResult - the acquisition must not restart.
    expect(isSameTrackingTarget(at(10, 10), at(10, 10))).toBe(true);
});

test("moving on to another point starts a new hover", () => {
    expect(isSameTrackingTarget(at(10, 10), at(10, 11))).toBe(false);
});

test("the same place reached by a different kind of snap is a different target", () => {
    expect(isSameTrackingTarget(at(10, 10, "end"), at(10, 10, "nearCurve"))).toBe(false);
});

test("nothing under the cursor is never the same as something", () => {
    expect(isSameTrackingTarget(undefined, at(10, 10))).toBe(false);
    expect(isSameTrackingTarget(at(10, 10), undefined)).toBe(false);
    expect(isSameTrackingTarget(undefined, undefined)).toBe(false);
});
