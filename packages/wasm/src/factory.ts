import {
    GeometryUtils,
    type ICompound,
    type ICurve,
    type IEdge,
    type IFace,
    type IShape,
    type IShapeFactory,
    type IVertex,
    type IWire,
    MathUtils,
    type Plane,
    Precision,
    Result,
    type XYZLike,
} from "@draftworks/core";

import type { ShapeResult, ShapesResult, TopoDS_Edge, TopoDS_Face, TopoDS_Shape } from "../lib/chili-wasm";
import { OccCurve } from "./curve";
import { convertFromContinuity, getJoinType } from "./helper";
import { OccEdge, OccShape } from "./shape";

function ensureOccShape(shapes: IShape | IShape[]): TopoDS_Shape[] {
    if (Array.isArray(shapes)) {
        return shapes.map((x) => {
            if (!(x instanceof OccShape)) {
                throw new Error("The OCC kernel only supports OCC geometries.");
            }
            return x.shape;
        });
    }

    if (shapes instanceof OccShape) {
        return [shapes.shape];
    }

    throw new Error("The OCC kernel only supports OCC geometries.");
}

function convertShapeResult<P extends unknown[] = unknown[]>(
    factory: (...params: P) => ShapeResult,
    params: P,
    errorString: string,
): Result<IShape, string> {
    let result: ShapeResult;
    try {
        result = factory(...params);
    } catch {
        return Result.err(errorString);
    }

    let res: Result<IShape, string>;
    if (!result.isOk) {
        res = Result.err(result.error);
    } else if (result.shape.isNull()) {
        res = Result.err("The shape is null.");
    } else {
        res = Result.ok(OccShape.wrap(result.shape));
    }

    result.delete();
    return res;
}

function convertShapesResult<P extends unknown[] = unknown[]>(
    factory: (...params: P) => ShapesResult,
    params: P,
    errorString: string,
): Result<IShape[], string> {
    let result: ShapesResult;
    try {
        result = factory(...params);
    } catch {
        return Result.err(errorString);
    }

    let res: Result<IShape[], string>;
    if (!result.isOk) {
        res = Result.err(result.error);
    } else {
        const shapes: IShape[] = [];
        const arr = result.shapes;
        for (let i = 0; i < arr.length; i++) {
            const ts = arr[i];
            if (ts && !ts.isNull()) {
                shapes.push(OccShape.wrap(ts));
            }
        }
        res = Result.ok(shapes);
    }

    result.delete();
    return res;
}

export class ShapeFactory implements IShapeFactory {
    readonly kernelName = "opencascade";

    edge(curve: ICurve): IEdge {
        if (!(curve instanceof OccCurve)) {
            throw new Error("Invalid curve");
        }
        return new OccEdge({ shape: wasm.Edge.fromCurve(curve.curve) });
    }

    fillet(shape: IShape, edges: number[], radius: number): Result<IShape> {
        if (radius < Precision.Distance) {
            return Result.err("The radius is too small.");
        }

        if (edges.length === 0) {
            return Result.err("The edges is empty.");
        }

        if (shape instanceof OccShape) {
            return convertShapeResult(wasm.ShapeFactory.fillet, [shape.shape, edges, radius], "Fillet Error");
        }
        return Result.err("Not OccShape");
    }

    chamfer(shape: IShape, edges: number[], distance: number): Result<IShape> {
        if (distance < Precision.Distance) {
            return Result.err("The distance is too small.");
        }

        if (edges.length === 0) {
            return Result.err("The edges is empty.");
        }

        if (shape instanceof OccShape) {
            return convertShapeResult(
                wasm.ShapeFactory.chamfer,
                [shape.shape, edges, distance],
                "Chamfer Error",
            );
        }
        return Result.err("Not OccShape");
    }

    fillet2d(face: IFace, edge1: IEdge, edge2: IEdge, radius: number): Result<IFace> {
        if (radius < Precision.Distance) {
            return Result.err("The radius is too small.");
        }

        const [occFace, occEdge1, occEdge2] = ensureOccShape([face, edge1, edge2]);
        return convertShapeResult(
            wasm.ShapeFactory.fillet2d,
            [occFace as TopoDS_Face, occEdge1 as TopoDS_Edge, occEdge2 as TopoDS_Edge, radius],
            "Fillet2d Error",
        ) as Result<IFace>;
    }

    filletEdge2d(edge1: IEdge, edge2: IEdge, radius: number): Result<IEdge[]> {
        if (radius < Precision.Distance) {
            return Result.err("The radius is too small.");
        }

        const [occEdge1, occEdge2] = ensureOccShape([edge1, edge2]);
        return convertShapesResult(
            wasm.ShapeFactory.filletEdge2d,
            [occEdge1 as TopoDS_Edge, occEdge2 as TopoDS_Edge, radius],
            "FilletEdge2d Error",
        ) as Result<IEdge[]>;
    }

    chamfer2d(face: IFace, edge1: IEdge, edge2: IEdge, distance: number): Result<IFace> {
        if (distance < Precision.Distance) {
            return Result.err("The distance is too small.");
        }

        const [occFace, occEdge1, occEdge2] = ensureOccShape([face, edge1, edge2]);
        return convertShapeResult(
            wasm.ShapeFactory.chamfer2d,
            [occFace as TopoDS_Face, occEdge1 as TopoDS_Edge, occEdge2 as TopoDS_Edge, distance],
            "Chamfer2d Error",
        ) as Result<IFace>;
    }

    chamferEdge2d(edge1: IEdge, edge2: IEdge, distance: number): Result<IEdge[]> {
        if (distance < Precision.Distance) {
            return Result.err("The distance is too small.");
        }

        const [occEdge1, occEdge2] = ensureOccShape([edge1, edge2]);
        return convertShapesResult(
            wasm.ShapeFactory.chamferEdge2d,
            [occEdge1 as TopoDS_Edge, occEdge2 as TopoDS_Edge, distance],
            "ChamferEdge2d Error",
        ) as Result<IEdge[]>;
    }

    removeSubShape(shape: IShape, subShapes: IShape[]): Result<IShape> {
        const occShape = ensureOccShape(shape);
        const occSubShapes = ensureOccShape(subShapes);
        return convertShapeResult(
            wasm.ShapeFactory.removeSubShape,
            [occShape[0], occSubShapes],
            "Remove SubShape Error",
        );
    }

    replaceSubShapes(shape: IShape, oldSubShapes: IShape[], newSubShapes: IShape[]): Result<IShape> {
        const occShape = ensureOccShape(shape);
        const occOld = ensureOccShape(oldSubShapes);
        const occNew = ensureOccShape(newSubShapes);
        return convertShapeResult(
            wasm.ShapeFactory.replaceSubShapes,
            [occShape[0], occOld, occNew],
            "Replace SubShapes Error",
        );
    }

    face(wire: IWire[]): Result<IFace> {
        if (wire.length === 0) {
            return Result.err("The wire is empty.");
        }
        const normal = GeometryUtils.normal(wire[0]);
        for (let i = 1; i < wire.length; i++) {
            if (GeometryUtils.isCCW(normal, wire[i])) {
                wire[i].reserve();
            }
        }
        const shapes = ensureOccShape(wire);
        return convertShapeResult(wasm.ShapeFactory.face, [shapes], "Face Error") as Result<IFace>;
    }
    faceFromSurface(wires: IWire[], sourceFace: IFace): Result<IFace> {
        if (wires.length === 0) {
            return Result.err("The wire is empty.");
        }
        const normal = GeometryUtils.normal(wires[0]);
        for (let i = 1; i < wires.length; i++) {
            if (GeometryUtils.isCCW(normal, wires[i])) {
                wires[i].reserve();
            }
        }
        const shapes = ensureOccShape(wires);
        const [occFace] = ensureOccShape(sourceFace);
        return convertShapeResult(
            wasm.ShapeFactory.faceFromSurface,
            [shapes, occFace],
            "FaceFromSurface Error",
        ) as Result<IFace>;
    }
    bezier(points: XYZLike[], weights?: number[]): Result<IEdge> {
        return convertShapeResult(
            wasm.ShapeFactory.bezier,
            [points, weights ?? []],
            "Bezier Error",
        ) as Result<IEdge>;
    }
    point(point: XYZLike): Result<IVertex> {
        return convertShapeResult(wasm.ShapeFactory.point, [point], "Point Error") as Result<IVertex>;
    }
    line(start: XYZLike, end: XYZLike): Result<IEdge> {
        if (MathUtils.allEqualZero(start.x - end.x, start.y - end.y, start.z - end.z)) {
            return Result.err("The start and end points are too close.");
        }

        return convertShapeResult(wasm.ShapeFactory.line, [start, end], "Line Error") as Result<IEdge>;
    }
    arc(normal: XYZLike, center: XYZLike, start: XYZLike, angle: number): Result<IEdge> {
        return convertShapeResult(
            wasm.ShapeFactory.arc,
            [normal, center, start, MathUtils.degToRad(angle)],
            "Arc Error",
        ) as Result<IEdge>;
    }
    circle(normal: XYZLike, center: XYZLike, radius: number): Result<IEdge> {
        return convertShapeResult(
            wasm.ShapeFactory.circle,
            [normal, center, radius],
            "Circle Error",
        ) as Result<IEdge>;
    }
    rect(plane: Plane, dx: number, dy: number): Result<IFace> {
        return convertShapeResult(
            wasm.ShapeFactory.rect,
            [
                {
                    location: plane.origin,
                    direction: plane.normal,
                    xDirection: plane.xvec,
                },
                dx,
                dy,
            ],
            "Rect Error",
        ) as Result<IFace>;
    }
    polygon(points: XYZLike[]): Result<IWire> {
        return convertShapeResult(wasm.ShapeFactory.polygon, [points], "Polygon Error") as Result<IWire>;
    }
    ellipse(
        normal: XYZLike,
        center: XYZLike,
        xvec: XYZLike,
        majorRadius: number,
        minorRadius: number,
    ): Result<IEdge> {
        return convertShapeResult(
            wasm.ShapeFactory.ellipse,
            [normal, center, xvec, majorRadius, minorRadius],
            "Ellipse Error",
        ) as Result<IEdge>;
    }
    wire(edges: IEdge[]): Result<IWire> {
        return convertShapeResult(
            wasm.ShapeFactory.wire,
            [ensureOccShape(edges)],
            "Wire Error",
        ) as Result<IWire>;
    }
    fuse(bottom: IShape, top: IShape): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.booleanFuse,
            [ensureOccShape(bottom), ensureOccShape(top)],
            "Fuse Error",
        );
    }
    booleanFuse(shape1: IShape[], shape2: IShape[], simplifyShape: boolean): Result<IShape> {
        const occShape1 = ensureOccShape(shape1);
        const occShape2 = ensureOccShape(shape2);

        const fused = convertShapeResult(
            wasm.ShapeFactory.booleanFuse,
            [occShape1, occShape2],
            "BooleanFuse Error",
        );

        if (!fused.isOk || !simplifyShape) {
            return fused;
        }

        const occShape = fused.value as OccShape;
        return convertShapeResult(
            wasm.ShapeFactory.simplifyShape,
            [occShape.shape, true, true, [], 1e-6, 1e-7],
            "SimplifyShape Error",
        );
    }
    combine(shapes: IShape[]): Result<ICompound> {
        return convertShapeResult(
            wasm.ShapeFactory.combine,
            [ensureOccShape(shapes)],
            "Combine Error",
        ) as Result<ICompound>;
    }
    simplifyShape(
        shape: IShape,
        removeEdges: boolean,
        removeFaces: boolean,
        keepShapes: IShape[],
        linearTolerance: number = 1e-6,
        angleTolerance: number = 1e-7,
    ): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.simplifyShape,
            [
                ensureOccShape(shape)[0],
                removeEdges,
                removeFaces,
                ensureOccShape(keepShapes),
                linearTolerance,
                angleTolerance,
            ],
            "SimplifyShape Error",
        );
    }
}
