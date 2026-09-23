// Text and dimensions store their geometry in their own fields - a text's insertion
// point and cap height, a dimension's picked points - and the renderer reads those
// directly, ignoring `transform`. So the modify commands' usual "compose a matrix onto
// node.transform" did nothing at all to an annotation: SCALE, MOVE, ROTATE and MIRROR
// left every label sitting at its original place and size while the geometry around it
// moved. These pin the override that bakes the matrix into those fields instead.

import { expect, test } from "@rstest/core";
import type { IDocument } from "../document";
import { Matrix4, XYZ } from "../math";
import { DimensionAnnotation, TextAnnotation } from "./annotation";

/**
 * Annotations touch the document only to read the current layer at construction and to
 * file an undo record on every property write; history is off, so the writes just land.
 */
const document = {
    modelManager: { currentLayerId: "0" },
    history: { disabled: true },
} as unknown as IDocument;

const at = (x: number, y: number) => new XYZ({ x, y, z: 0 });

/** SCALE's matrix: to the origin, scale, and back - see Scale.transfrom. */
function scaleAbout(base: XYZ, factor: number) {
    return Matrix4.fromTranslation(-base.x, -base.y, -base.z)
        .multiply(Matrix4.fromScale(factor, factor, factor))
        .multiply(Matrix4.fromTranslation(base.x, base.y, base.z));
}

const text = (position: XYZ, height: number, boxWidth = 0) =>
    new TextAnnotation({
        document,
        annotationType: "text",
        name: "t",
        content: "HELLO",
        position,
        height,
        boxWidth,
    });

test("scaling text grows its cap height by the factor", () => {
    const annotation = text(at(10, 0), 2.5);

    annotation.applyTransform(scaleAbout(XYZ.zero, 2));

    expect(annotation.height).toBeCloseTo(5);
});

test("scaling text moves its insertion point towards the base point", () => {
    const annotation = text(at(10, 4), 2.5);

    annotation.applyTransform(scaleAbout(XYZ.zero, 2));

    expect(annotation.position.x).toBeCloseTo(20);
    expect(annotation.position.y).toBeCloseTo(8);
});

test("the base point of a scale is the one point that does not move", () => {
    const base = at(10, 4);
    const annotation = text(base, 2.5);

    annotation.applyTransform(scaleAbout(base, 3));

    expect(annotation.position.x).toBeCloseTo(10);
    expect(annotation.position.y).toBeCloseTo(4);
});

test("an MTEXT wrap width scales with the height, so the block keeps its proportions", () => {
    const annotation = text(at(0, 0), 2.5, 40);

    annotation.applyTransform(scaleAbout(XYZ.zero, 0.5));

    expect(annotation.height).toBeCloseTo(1.25);
    expect(annotation.boxWidth).toBeCloseTo(20);
});

test("single-line TEXT keeps a zero wrap width, staying TEXT rather than becoming MTEXT", () => {
    const annotation = text(at(0, 0), 2.5);

    annotation.applyTransform(scaleAbout(XYZ.zero, 4));

    expect(annotation.boxWidth).toBe(0);
});

test("moving text carries the point but leaves the height alone", () => {
    const annotation = text(at(1, 1), 2.5);

    annotation.applyTransform(Matrix4.fromTranslation(5, 7, 0));

    expect(annotation.position.x).toBeCloseTo(6);
    expect(annotation.position.y).toBeCloseTo(8);
    expect(annotation.height).toBeCloseTo(2.5);
});

test("scaling a dimension moves its picked points, so it measures its new length", () => {
    const annotation = new DimensionAnnotation({
        document,
        annotationType: "dimension",
        name: "d",
        dimensionType: "linear",
        startPoint: at(0, 0),
        endPoint: at(100, 0),
        offsetPoint: at(50, 20),
        normal: XYZ.unitZ,
        xAxis: XYZ.unitX,
    });

    annotation.applyTransform(scaleAbout(XYZ.zero, 2));

    expect(annotation.endPoint.x).toBeCloseTo(200);
    expect(annotation.geometry()?.value).toBeCloseTo(200);
});

test("scaling a radial dimension scales the radius it reports", () => {
    const annotation = new DimensionAnnotation({
        document,
        annotationType: "dimension",
        name: "d",
        dimensionType: "radius",
        startPoint: at(0, 0),
        endPoint: at(10, 0),
        offsetPoint: at(10, 0),
        radius: 10,
        normal: XYZ.unitZ,
        xAxis: XYZ.unitX,
    });

    annotation.applyTransform(scaleAbout(XYZ.zero, 2.5));

    expect(annotation.radius).toBeCloseTo(25);
});
