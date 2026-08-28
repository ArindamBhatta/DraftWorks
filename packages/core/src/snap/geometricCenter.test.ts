// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// The centroid formula behind the Geometric Center snap. The easy cases (rectangle,
// square) are symmetric, so a sign error hides in them - the L-shape and triangle are
// the ones that actually pin the shoelace weighting down.

import { expect, test } from "@rstest/core";
import { Plane, XYZ } from "../math";
import { polygonCentroid } from "./geometricCenter";

const at = (x: number, y: number) => new XYZ({ x, y, z: 0 });

test("a rectangle's centre is the middle of its diagonal", () => {
    const centre = polygonCentroid([at(0, 0), at(10, 0), at(10, 4), at(0, 4)], Plane.XY);

    expect(centre!.x).toBeCloseTo(5);
    expect(centre!.y).toBeCloseTo(2);
});

test("winding direction does not change the answer", () => {
    const ccw = polygonCentroid([at(0, 0), at(10, 0), at(10, 4), at(0, 4)], Plane.XY);
    const cw = polygonCentroid([at(0, 4), at(10, 4), at(10, 0), at(0, 0)], Plane.XY);

    expect(cw!.x).toBeCloseTo(ccw!.x);
    expect(cw!.y).toBeCloseTo(ccw!.y);
});

test("a triangle's centroid is the average of its corners, not of its bounding box", () => {
    // Bounding-box centre would be (3, 3); the true centroid is (2, 2).
    const centre = polygonCentroid([at(0, 0), at(6, 0), at(0, 6)], Plane.XY);

    expect(centre!.x).toBeCloseTo(2);
    expect(centre!.y).toBeCloseTo(2);
});

test("a concave shape's centroid is area-weighted, so it leans toward the bulk", () => {
    // An L built from a 4x2 foot (area 8, centre (2,1)) and a 2x2 upright (area 4,
    // centre (1,3)): the balance point is (8*2 + 4*1)/12 = 5/3 in both axes. Both
    // the plain average of the six corners and the bounding-box centre would say
    // (2, 2), so this is the case that tells the area weighting is really happening.
    const centre = polygonCentroid([at(0, 0), at(4, 0), at(4, 2), at(2, 2), at(2, 4), at(0, 4)], Plane.XY);

    expect(centre!.x).toBeCloseTo(5 / 3);
    expect(centre!.y).toBeCloseTo(5 / 3);
});

test("a regular polygon centres on its middle", () => {
    // A square rotated 45 degrees - a diamond about (0, 0).
    const centre = polygonCentroid([at(5, 0), at(0, 5), at(-5, 0), at(0, -5)], Plane.XY);

    expect(centre!.x).toBeCloseTo(0);
    expect(centre!.y).toBeCloseTo(0);
});

test("a repeated closing point does not skew the result", () => {
    const open = polygonCentroid([at(0, 0), at(10, 0), at(10, 4), at(0, 4)], Plane.XY);
    const closed = polygonCentroid([at(0, 0), at(10, 0), at(10, 4), at(0, 4), at(0, 0)], Plane.XY);

    expect(closed!.x).toBeCloseTo(open!.x);
    expect(closed!.y).toBeCloseTo(open!.y);
});

test("the centre is measured away from the world origin correctly", () => {
    const centre = polygonCentroid([at(100, 50), at(110, 50), at(110, 54), at(100, 54)], Plane.XY);

    expect(centre!.x).toBeCloseTo(105);
    expect(centre!.y).toBeCloseTo(52);
});

test("collinear points enclose no area, so it falls back to their average", () => {
    const centre = polygonCentroid([at(0, 0), at(5, 0), at(10, 0)], Plane.XY);

    expect(centre!.x).toBeCloseTo(5);
    expect(centre!.y).toBeCloseTo(0);
});

test("fewer than three points has no centre at all", () => {
    expect(polygonCentroid([], Plane.XY)).toBeUndefined();
    expect(polygonCentroid([at(1, 1)], Plane.XY)).toBeUndefined();
    expect(polygonCentroid([at(0, 0), at(1, 1)], Plane.XY)).toBeUndefined();
});

test("works in a plane that is not world XY", () => {
    // The same rectangle standing in the XZ plane.
    const plane = new Plane({ origin: XYZ.zero, normal: XYZ.unitY, xvec: XYZ.unitX });
    const centre = polygonCentroid(
        [
            new XYZ({ x: 0, y: 0, z: 0 }),
            new XYZ({ x: 10, y: 0, z: 0 }),
            new XYZ({ x: 10, y: 0, z: -4 }),
            new XYZ({ x: 0, y: 0, z: -4 }),
        ],
        plane,
    );

    expect(centre!.x).toBeCloseTo(5);
    expect(centre!.z).toBeCloseTo(-2);
    expect(centre!.y).toBeCloseTo(0);
});
