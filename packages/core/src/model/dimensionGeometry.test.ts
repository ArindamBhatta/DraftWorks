// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { XYZ } from "../math";
import { buildDimensionGeometry, type DimensionFrame } from "./dimensionGeometry";

const frame: DimensionFrame = { normal: XYZ.unitZ, xAxis: XYZ.unitX };

const linear = (start: XYZ, end: XYZ, offsetPoint: XYZ) =>
    buildDimensionGeometry({ type: "linear", start, end, offsetPoint, frame });

const at = (x: number, y: number) => new XYZ({ x, y, z: 0 });

/**
 * DIMLINEAR resolves horizontal vs vertical from which side of the two origins the
 * dimension line was placed. The cases that matter are the ones where the span itself is
 * long: the offset point is then far from `start` along the span, and a rule that only
 * looked at that vector chose the axis the span runs along - measuring zero.
 */
describe("linear dimension axis resolution", () => {
    test("dimension line placed above a horizontal span measures its length", () => {
        expect(linear(at(0, 0), at(100, 0), at(50, 20))?.value).toBeCloseTo(100);
    });

    test("offset entered from the second origin still measures the length", () => {
        // What typing a distance at the third prompt produces: 20 away from the second
        // origin, so 100 along the span from `start`.
        expect(linear(at(0, 0), at(100, 0), at(100, 20))?.value).toBeCloseTo(100);
    });

    test("dimension line placed beside a vertical span measures its height", () => {
        expect(linear(at(0, 0), at(0, 100), at(30, 100))?.value).toBeCloseTo(100);
    });

    test("a diagonal span measures its horizontal component when placed above", () => {
        expect(linear(at(0, 0), at(100, 50), at(100, 70))?.value).toBeCloseTo(100);
    });

    test("a diagonal span measures its vertical component when placed beside", () => {
        expect(linear(at(0, 0), at(100, 50), at(140, 50))?.value).toBeCloseTo(50);
    });

    test("aligned measures the true distance regardless of where it is placed", () => {
        const geometry = buildDimensionGeometry({
            type: "aligned",
            start: at(0, 0),
            end: at(30, 40),
            offsetPoint: at(30, 60),
            frame,
        });
        expect(geometry?.value).toBeCloseTo(50);
    });
});
