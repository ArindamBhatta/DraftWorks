// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// MIRROR's reflection plane. The failure worth guarding against is subtle: a plane
// built from the wrong pair of vectors still produces a plausible-looking transform,
// but it rotates the drawing instead of flipping it - and a symmetric test shape
// cannot tell the two apart. The handedness check below is the one that can.

import { Matrix4, Plane, XYZ } from "@chili3d/core";
import { expect, test } from "@rstest/core";

const at = (x: number, y: number) => new XYZ({ x, y, z: 0 });
const workplaneNormal = XYZ.unitZ;

/** The mirror plane Mirror.mirrorPlane builds from the two picked points. */
const mirrorMatrix = (start: XYZ, end: XYZ) =>
    Matrix4.createMirrorWithPlane(
        new Plane({
            origin: start,
            normal: end.sub(start).cross(workplaneNormal),
            xvec: workplaneNormal,
        }),
    );

test("mirroring about a vertical line flips x and leaves y alone", () => {
    const matrix = mirrorMatrix(at(0, 0), at(0, 10));
    const flipped = matrix.ofPoint(at(3, 7));

    expect(flipped.x).toBeCloseTo(-3);
    expect(flipped.y).toBeCloseTo(7);
});

test("mirroring about a horizontal line flips y and leaves x alone", () => {
    const matrix = mirrorMatrix(at(0, 0), at(10, 0));
    const flipped = matrix.ofPoint(at(3, 7));

    expect(flipped.x).toBeCloseTo(3);
    expect(flipped.y).toBeCloseTo(-7);
});

test("points on the mirror line do not move", () => {
    const matrix = mirrorMatrix(at(0, 0), at(10, 10));

    for (const onLine of [at(0, 0), at(5, 5), at(-2, -2)]) {
        const result = matrix.ofPoint(onLine);
        expect(result.x).toBeCloseTo(onLine.x);
        expect(result.y).toBeCloseTo(onLine.y);
    }
});

test("mirroring about a 45 degree line swaps x and y", () => {
    const matrix = mirrorMatrix(at(0, 0), at(10, 10));
    const flipped = matrix.ofPoint(at(4, 1));

    expect(flipped.x).toBeCloseTo(1);
    expect(flipped.y).toBeCloseTo(4);
});

test("the mirror line does not have to pass through the origin", () => {
    // Vertical line at x = 10: a point 3 to its left lands 3 to its right.
    const matrix = mirrorMatrix(at(10, 0), at(10, 5));
    const flipped = matrix.ofPoint(at(7, 2));

    expect(flipped.x).toBeCloseTo(13);
    expect(flipped.y).toBeCloseTo(2);
});

test("mirroring twice returns the original", () => {
    const matrix = mirrorMatrix(at(2, 1), at(9, 4));
    const start = at(-3, 6);

    const there = matrix.ofPoint(start);
    const back = matrix.ofPoint(there);

    expect(back.x).toBeCloseTo(start.x);
    expect(back.y).toBeCloseTo(start.y);
});

test("it really reflects rather than rotates - handedness is reversed", () => {
    // A rotation preserves winding; a reflection reverses it. Taking the cross
    // product of two edges of a triangle before and after, the z components must come
    // out with opposite signs. A symmetric shape would pass either way, which is why
    // this uses a deliberately lopsided one.
    const matrix = mirrorMatrix(at(0, 0), at(10, 3));
    const [a, b, c] = [at(1, 1), at(6, 2), at(2, 5)];

    const windingOf = (p: XYZ, q: XYZ, r: XYZ) => q.sub(p).cross(r.sub(p)).z;

    const before = windingOf(a, b, c);
    const after = windingOf(matrix.ofPoint(a), matrix.ofPoint(b), matrix.ofPoint(c));

    expect(Math.sign(after)).toBe(-Math.sign(before));
    expect(Math.abs(after)).toBeCloseTo(Math.abs(before));
});
