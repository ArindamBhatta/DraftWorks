import type { Result } from "../foundation";
import type { Line, Plane, XYZ, XYZLike } from "../math";
import type { Continuity, ICurve } from "./curve";
import type { ICompound, IEdge, IFace, IShape, IShell, ISolid, IVertex, IWire, JoinType } from "./shape";

// IShapeFactory is the single construction API for every kind of shape this app can
// build - 2D/planar primitives (circle, rect, polygon, arc, ellipse, fillet2d,
// chamferEdge2d, ...) sit side by side with 3D/solid primitives and operations (box,
// cylinder, sweep, revolve, booleanFuse, makeThickSolidByJoin, ...) on one interface,
// implemented by one class (packages/wasm/src/factory.ts, wrapping the compiled OCCT
// kernel). This mirrors IShape's design (see shape.ts): OCCT itself has no 2D/3D
// kernel split, so splitting this interface in two would add a seam with nothing
// underneath it to justify it. Practically, this also means: trimming this app down
// to a 2D-only tool means simply not calling the solid-producing methods below
// (box/cylinder/cone/sphere/pyramid/prism/revolve/sweep/loft/boolean*/
// makeThickSolid*) from commands/bodies, not deleting them from the interface -
// unless the wasm/OCCT dependency itself is being replaced with a different kernel.
export interface IShapeFactory {
    readonly kernelName: string;
    edge(curve: ICurve): IEdge;
    face(wire: IWire[]): Result<IFace>;
    faceFromSurface(wires: IWire[], sourceFace: IFace): Result<IFace>;
    shell(faces: IFace[]): Result<IShell>;
    solid(shells: IShell[]): Result<ISolid>;
    bezier(points: XYZLike[], weights?: number[]): Result<IEdge>;
    point(point: XYZLike): Result<IVertex>;
    line(start: XYZLike, end: XYZLike): Result<IEdge>;
    arc(normal: XYZLike, center: XYZLike, start: XYZLike, angle: number): Result<IEdge>;
    circle(normal: XYZLike, center: XYZLike, radius: number): Result<IEdge>;
    rect(plane: Plane, dx: number, dy: number): Result<IFace>;
    polygon(points: XYZLike[]): Result<IWire>;
    box(plane: Plane, dx: number, dy: number, dz: number): Result<ISolid>;
    ellipse(
        normal: XYZLike,
        center: XYZLike,
        xvec: XYZLike,
        majorRadius: number,
        minorRadius: number,
    ): Result<IEdge>;
    cylinder(normal: XYZLike, center: XYZLike, radius: number, dz: number): Result<ISolid>;
    cone(normal: XYZLike, center: XYZLike, radius: number, radiusUp: number, dz: number): Result<ISolid>;
    sphere(center: XYZLike, radius: number): Result<ISolid>;
    pyramid(plane: Plane, dx: number, dy: number, dz: number): Result<ISolid>;
    wire(edges: IEdge[]): Result<IWire>;
    prism(shape: IShape, vec: XYZ): Result<IShape>;
    pushPull(shape: IShape, face: IShape, vec: XYZ): Result<IShape>;
    fuse(bottom: IShape, top: IShape): Result<IShape>;
    sweep(profile: IShape[], path: IWire, isRoundCorner: boolean): Result<IShape>;
    revolve(profile: IShape, axis: Line, angle: number): Result<IShape>;
    booleanCommon(shape1: IShape[], shape2: IShape[]): Result<IShape>;
    booleanCut(shape1: IShape[], shape2: IShape[]): Result<IShape>;
    booleanFuse(shape1: IShape[], shape2: IShape[], simplifyShape: boolean): Result<IShape>;
    sewing(shapes: IShape[]): Result<IShape>;
    combine(shapes: IShape[]): Result<ICompound>;
    makeThickSolidBySimple(shape: IShape, thickness: number): Result<IShape>;
    makeThickSolidByJoin(
        shape: IShape,
        openFaces: IShape[],
        thickness: number,
        joinType: JoinType,
    ): Result<IShape>;
    fillet(shape: IShape, edges: number[], radius: number): Result<IShape>;
    chamfer(shape: IShape, edges: number[], distance: number): Result<IShape>;
    fillet2d(face: IFace, edge1: IEdge, edge2: IEdge, radius: number): Result<IFace>;
    chamfer2d(face: IFace, edge1: IEdge, edge2: IEdge, distance: number): Result<IFace>;
    filletEdge2d(edge1: IEdge, edge2: IEdge, radius: number): Result<IEdge[]>;
    chamferEdge2d(edge1: IEdge, edge2: IEdge, distance: number): Result<IEdge[]>;
    loft(
        sections: (IVertex | IEdge | IWire)[],
        isSolid: boolean,
        isRuled: boolean,
        continuity: Continuity,
    ): Result<IShape>;
    removeFeature(shape: IShape, faces: IFace[]): Result<IShape>;
    removeFillet(
        shape: IShape,
        faces: IFace[],
    ): Result<{
        shape: IShape;
        newEdges: IEdge[];
    }>;
    removeSubShape(shape: IShape, subShapes: IShape[]): Result<IShape>;
    replaceSubShapes(shape: IShape, oldSubShapes: IShape[], newSubShapes: IShape[]): Result<IShape>;
    curveProjection(curve: IEdge | IWire, targetFace: IFace, vec: XYZ): Result<IShape>;
    simplifyShape(
        shape: IShape,
        removeEdges: boolean,
        removeFaces: boolean,
        keepShapes: IShape[],
        linearTolerance?: number,
        angleTolerance?: number,
    ): Result<IShape>;
}
