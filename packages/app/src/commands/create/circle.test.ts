// circumcircle() is the one piece of new math the 3P circle mode depends on - it has
// to agree with the textbook circumcenter answer, has to reject collinear/coincident
// points (the case the third point's validator relies on to block a bad pick), and
// has to work in a plane that isn't just world XY.

import { Plane, XYZ } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { circumcircle } from "./circle";

test("three points on a known circle recover its center and radius", () => {
    // A circle of radius 5 centered at the origin, in the XY plane: (5,0), (0,5), (-5,0).
    const result = circumcircle(
        new XYZ({ x: 5, y: 0, z: 0 }),
        new XYZ({ x: 0, y: 5, z: 0 }),
        new XYZ({ x: -5, y: 0, z: 0 }),
        Plane.XY,
    );

    expect(result).toBeDefined();
    expect(result!.center.x).toBeCloseTo(0);
    expect(result!.center.y).toBeCloseTo(0);
    expect(result!.radius).toBeCloseTo(5);
});

test("a right triangle's hypotenuse is the circle's diameter", () => {
    // (0,0), (4,0), (0,3): the circumcenter of a right triangle sits at the midpoint
    // of the hypotenuse, radius half its length - here the 3-4-5 triangle's hypotenuse.
    const result = circumcircle(
        new XYZ({ x: 0, y: 0, z: 0 }),
        new XYZ({ x: 4, y: 0, z: 0 }),
        new XYZ({ x: 0, y: 3, z: 0 }),
        Plane.XY,
    );

    expect(result).toBeDefined();
    expect(result!.center.x).toBeCloseTo(2);
    expect(result!.center.y).toBeCloseTo(1.5);
    expect(result!.radius).toBeCloseTo(2.5);
});

test("three collinear points have no circumcircle", () => {
    const result = circumcircle(
        new XYZ({ x: 0, y: 0, z: 0 }),
        new XYZ({ x: 1, y: 1, z: 0 }),
        new XYZ({ x: 2, y: 2, z: 0 }),
        Plane.XY,
    );

    expect(result).toBeUndefined();
});

test("a repeated point has no circumcircle", () => {
    const result = circumcircle(
        new XYZ({ x: 0, y: 0, z: 0 }),
        new XYZ({ x: 1, y: 1, z: 0 }),
        new XYZ({ x: 0, y: 0, z: 0 }),
        Plane.XY,
    );

    expect(result).toBeUndefined();
});

test("works in a plane that is not world XY", () => {
    // The same 3-4-5 triangle as above, but lying in the XZ plane instead - the
    // circle's center and radius should come out the same, just placed on that plane.
    const plane = new Plane({ origin: XYZ.zero, normal: XYZ.unitY, xvec: XYZ.unitX });
    const result = circumcircle(
        new XYZ({ x: 0, y: 0, z: 0 }),
        new XYZ({ x: 4, y: 0, z: 0 }),
        new XYZ({ x: 0, y: 0, z: -3 }),
        plane,
    );

    expect(result).toBeDefined();
    expect(result!.radius).toBeCloseTo(2.5);
    expect(result!.center.y).toBeCloseTo(0);
});
