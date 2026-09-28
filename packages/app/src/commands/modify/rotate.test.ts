// ROTATE's angle convention. A sign or reference error here does not throw - it
// quietly turns the drawing the wrong way, or by the wrong amount, which is the kind
// of thing that only shows up as "rotate is broken" long after the fact. These pin
// down the two things the command promises: zero degrees is due east, and Reference
// mode measures from the direction the user nominated instead.

import { Matrix4, Plane, XYZ } from "@draftworks/core";
import { expect, test } from "@rstest/core";

const at = (x: number, y: number) => new XYZ({ x, y, z: 0 });
const plane = Plane.XY;

/** The angle ROTATE applies, mirroring Rotate.getAngle for the default mode. */
const absoluteAngle = (center: XYZ, cursor: XYZ) =>
    plane.xvec.angleOnPlaneTo(cursor.sub(center), plane.normal)!;

/** ...and for Reference mode, where zero is a direction the user picked. */
const referenceAngle = (center: XYZ, reference: XYZ, cursor: XYZ) =>
    reference.sub(center).angleOnPlaneTo(cursor.sub(center), plane.normal)!;

const degrees = (radians: number) => (radians * 180) / Math.PI;

test("zero degrees is due east of the base point", () => {
    expect(degrees(absoluteAngle(XYZ.zero, at(10, 0)))).toBeCloseTo(0);
});

test("angles run counter-clockwise, as they do in AutoCAD", () => {
    expect(degrees(absoluteAngle(XYZ.zero, at(0, 10)))).toBeCloseTo(90);
    expect(degrees(absoluteAngle(XYZ.zero, at(-10, 0)))).toBeCloseTo(180);
    expect(degrees(absoluteAngle(XYZ.zero, at(0, -10)))).toBeCloseTo(270);
});

test("the angle is measured from the base point, not the world origin", () => {
    const base = at(100, 100);
    expect(degrees(absoluteAngle(base, at(100, 110)))).toBeCloseTo(90);
});

test("rotating by the computed angle lands a point where the cursor was", () => {
    // The whole contract: whatever angle the preview reports, applying it must put
    // the object under the cursor.
    const base = XYZ.zero;
    const cursor = at(0, 10);
    const matrix = Matrix4.fromAxisRad(base, plane.normal, absoluteAngle(base, cursor));

    const moved = matrix.ofPoint(at(10, 0));
    expect(moved.x).toBeCloseTo(0);
    expect(moved.y).toBeCloseTo(10);
});

test("a typed 90 turns a horizontal edge to vertical", () => {
    const matrix = Matrix4.fromAxisRad(XYZ.zero, plane.normal, Math.PI / 2);
    const end = matrix.ofPoint(at(5, 0));

    expect(end.x).toBeCloseTo(0);
    expect(end.y).toBeCloseTo(5);
});

test("Reference mode measures from the nominated direction, not from east", () => {
    // Something lying at 30 degrees, to be brought to 45: the turn is 15, not 45.
    const base = XYZ.zero;
    const reference = at(Math.cos(Math.PI / 6) * 10, Math.sin(Math.PI / 6) * 10);
    const target = at(Math.cos(Math.PI / 4) * 10, Math.sin(Math.PI / 4) * 10);

    expect(degrees(referenceAngle(base, reference, target))).toBeCloseTo(15);
    // The same pick read absolutely would have turned it by 45 - the bug Reference exists to avoid.
    expect(degrees(absoluteAngle(base, target))).toBeCloseTo(45);
});

test("Reference mode turning backwards wraps rather than going negative", () => {
    // From 45 back to 30 is -15, which comes back as 345 - the same rotation.
    const base = XYZ.zero;
    const reference = at(Math.cos(Math.PI / 4) * 10, Math.sin(Math.PI / 4) * 10);
    const target = at(Math.cos(Math.PI / 6) * 10, Math.sin(Math.PI / 6) * 10);

    const turn = referenceAngle(base, reference, target);
    expect(degrees(turn)).toBeCloseTo(345);

    // Wrapping must not change where the object actually ends up.
    const landed = Matrix4.fromAxisRad(base, plane.normal, turn).ofPoint(reference);
    expect(landed.x).toBeCloseTo(target.x);
    expect(landed.y).toBeCloseTo(target.y);
});
