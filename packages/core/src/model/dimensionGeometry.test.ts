// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import type { DimensionSettings } from "../foundation/unitSetup";
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

/**
 * The Lines, Symbols and Arrows and Fit tabs of DIMSTYLE all act on the layout rather than
 * on the label, so what they change is countable: how many line segments come out, how
 * many arrow triangles, and where the text ends up.
 */
describe("dimension style geometry", () => {
    const span = { start: at(0, 0), end: at(100, 0), offsetPoint: at(50, 20) };

    const build = (settings: Partial<DimensionSettings>) =>
        buildDimensionGeometry({ type: "linear", ...span, frame, settings });

    /** Point pairs in a flat [ax,ay,az, bx,by,bz, ...] array. */
    const segments = (flat: number[]) => flat.length / 6;
    /** Triangles in a flat vertex array. */
    const triangles = (flat: number[]) => flat.length / 9;

    test("DIMSCALE grows the drawn features and leaves the measurement alone", () => {
        const plain = build({ overallScale: 1 })!;
        const doubled = build({ overallScale: 2 })!;

        expect(doubled.value).toBeCloseTo(plain.value);
        expect(doubled.text).toBe(plain.text);
        // Everything drawn is twice as far from the dimension line it hangs off.
        const reach = (geometry: typeof plain) =>
            Math.max(...geometry.extensionLines.filter((_, i) => i % 3 === 1));
        expect(reach(doubled)).toBeGreaterThan(reach(plain));
    });

    test("suppressing an extension line removes it rather than hiding it", () => {
        const both = build({})!;
        const one = build({ suppressExtLine1: true })!;
        const neither = build({ suppressExtLine1: true, suppressExtLine2: true })!;

        expect(segments(one.extensionLines)).toBe(segments(both.extensionLines) - 1);
        expect(neither.extensionLines).toHaveLength(0);
    });

    test("suppressing both halves removes the dimension line", () => {
        const geometry = build({ suppressDimLine1: true, suppressDimLine2: true })!;

        // Only the arrowheads are left, and filled ones contribute no line work at all.
        expect(geometry.dimensionLines).toHaveLength(0);
        expect(triangles(geometry.arrows)).toBe(2);
    });

    test("a filled arrowhead is a triangle and a stroked one is line work", () => {
        const filled = build({ arrowhead1: "closedFilled", arrowhead2: "closedFilled" })!;
        const open = build({ arrowhead1: "open", arrowhead2: "open" })!;
        const none = build({ arrowhead1: "none", arrowhead2: "none" })!;

        expect(triangles(filled.arrows)).toBe(2);
        expect(open.arrows).toHaveLength(0);
        // Two barbs per head, on top of the dimension line itself.
        expect(segments(open.dimensionLines)).toBeGreaterThan(segments(filled.dimensionLines));
        expect(none.arrows).toHaveLength(0);
    });

    test("a dot head is drawn as a fan rather than a single triangle", () => {
        const geometry = build({ arrowhead1: "dot", arrowhead2: "none" })!;

        expect(triangles(geometry.arrows)).toBeGreaterThan(4);
    });

    test("DIMEXO moves where an extension line starts, DIMEXE where it ends", () => {
        const near = build({ extensionOffset: 0, extensionBeyondDimLine: 0 })!;
        const offset = build({ extensionOffset: 5, extensionBeyondDimLine: 0 })!;
        const beyond = build({ extensionOffset: 0, extensionBeyondDimLine: 5 })!;

        // The first extension line runs up from the origin, so its start and end are the
        // second and fifth numbers of the first pair.
        expect(offset.extensionLines[1]).toBeCloseTo(near.extensionLines[1] + 5);
        expect(beyond.extensionLines[4]).toBeCloseTo(near.extensionLines[4] + 5);
    });

    test("a fixed extension length measures back from the dimension line", () => {
        const geometry = build({
            fixedExtensionLength: true,
            extensionLength: 4,
            extensionBeyondDimLine: 0,
        })!;

        // Ends at the dimension line (y = 20), starts 4 below it - not at the object.
        expect(geometry.extensionLines[4]).toBeCloseTo(20);
        expect(geometry.extensionLines[1]).toBeCloseTo(16);
    });

    test("text too wide for the span is moved outside it", () => {
        // A span of 4 units cannot hold a 10-unit-tall label and two arrowheads.
        const tight = buildDimensionGeometry({
            type: "linear",
            start: at(0, 0),
            end: at(4, 0),
            offsetPoint: at(2, 20),
            frame,
            settings: { textHeight: 10, arrowSize: 3, fit: "either" },
        })!;

        // Past the second extension line rather than between the two.
        expect(tight.textPosition.x).toBeGreaterThan(4);
    });

    test("DIMTIX keeps the text between the extension lines however tight it is", () => {
        const geometry = buildDimensionGeometry({
            type: "linear",
            start: at(0, 0),
            end: at(4, 0),
            offsetPoint: at(2, 20),
            frame,
            settings: { textHeight: 10, arrowSize: 3, fit: "textAlways" },
        })!;

        expect(geometry.textPosition.x).toBeCloseTo(2);
    });

    test("centred text breaks the dimension line to make room for itself", () => {
        const above = build({ textVertical: "above" })!;
        const centred = build({ textVertical: "centered" })!;

        // Two halves either way, but the centred one leaves a gap between them.
        expect(segments(centred.dimensionLines)).toBe(segments(above.dimensionLines));
        expect(centred.textPosition.y).toBeCloseTo(20);
        expect(above.textPosition.y).toBeGreaterThan(20);
    });

    test("text sits below the dimension line when DIMTAD says so", () => {
        const above = build({ textVertical: "above" })!;
        const below = build({ textVertical: "below" })!;

        expect(below.textPosition.y).toBeLessThan(20);
        expect(above.textPosition.y).toBeGreaterThan(20);
    });

    test("DIMJUST slides the text along the dimension line", () => {
        expect(build({ textHorizontal: "centered" })!.textPosition.x).toBeCloseTo(50);
        expect(build({ textHorizontal: "atExt1" })!.textPosition.x).toBeLessThan(50);
        expect(build({ textHorizontal: "atExt2" })!.textPosition.x).toBeGreaterThan(50);
    });

    test("aligned text follows the dimension line and horizontal text never turns", () => {
        const diagonal = {
            type: "aligned" as const,
            start: at(0, 0),
            end: at(100, 100),
            offsetPoint: at(60, 80),
            frame,
        };

        const aligned = buildDimensionGeometry({ ...diagonal, settings: { textAlignment: "aligned" } })!;
        const upright = buildDimensionGeometry({ ...diagonal, settings: { textAlignment: "horizontal" } })!;

        expect(aligned.textRotation).toBeCloseTo(Math.PI / 4);
        expect(upright.textRotation).toBe(0);
    });

    test("a label never ends up upside down, however the dimension was drawn", () => {
        // Right to left: the line's own direction points backwards, which read literally
        // would turn the text through half a circle.
        const geometry = buildDimensionGeometry({
            type: "aligned",
            start: at(100, 0),
            end: at(0, 0),
            offsetPoint: at(50, 20),
            frame,
            settings: { textAlignment: "aligned" },
        })!;

        expect(Math.abs(geometry.textRotation)).toBeLessThanOrEqual(Math.PI / 2);
    });

    test("a centre mark is drawn on the circle a radius dimension measures", () => {
        const radius = (settings: Partial<DimensionSettings>) =>
            buildDimensionGeometry({
                type: "radius",
                start: at(0, 0),
                end: at(0, 0),
                radius: 20,
                offsetPoint: at(10, 10),
                frame,
                settings,
            })!;

        expect(radius({ centerMark: "none" }).extensionLines).toHaveLength(0);
        // A cross is two strokes; centre lines add two more on each axis.
        expect(segments(radius({ centerMark: "mark" }).extensionLines)).toBe(2);
        expect(segments(radius({ centerMark: "line" }).extensionLines)).toBe(6);
    });

    test("lines carries the dimension and extension line work between them", () => {
        const geometry = build({})!;

        expect(geometry.lines).toHaveLength(geometry.dimensionLines.length + geometry.extensionLines.length);
    });
});

test("a centred label wider than the span does not draw the line back through itself", () => {
    const geometry = buildDimensionGeometry({
        type: "linear",
        start: at(0, 0),
        end: at(10, 0),
        offsetPoint: at(5, 20),
        frame,
        // Wide enough to fit by the Fit rules, but its gap alone is wider than the span.
        settings: { textVertical: "centered", textHeight: 3, textOffset: 20, arrowSize: 0.5 },
    })!;

    // Each half runs outward from its own end, never past the midpoint.
    for (let i = 0; i + 5 < geometry.dimensionLines.length; i += 6) {
        const [ax, , , bx] = geometry.dimensionLines.slice(i, i + 6);
        expect(Math.min(ax, bx)).toBeGreaterThanOrEqual(0);
        expect(Math.max(ax, bx)).toBeLessThanOrEqual(10);
    }
});
