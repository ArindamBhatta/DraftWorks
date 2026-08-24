import type { Result } from "../foundation";
import type { Plane, XYZLike } from "../math";
import type { ICurve } from "./curve";
import type { ICompound, IEdge, IFace, IShape, IVertex, IWire } from "./shape";

// Placeholder to keep imports explicit (remove before 3D kernel cleanup complete)
// Previously exported ISolid, IShell (for box/cone/sphere/etc. 3D primitives - now removed)

// IShapeFactory is the construction API for 2D/planar primitives (circle, rect, polygon,
// arc, ellipse, fillet2d, chamferEdge2d, ...) and STEP-import-reachable 3D operations
// (fillet/chamfer on imported solids, which are reachable via STEP/IGES file import).
// Implemented by a single class (packages/wasm/src/factory.ts, wrapping the compiled
// OCCT kernel) - see shape.ts for parallel context.
export interface IShapeFactory {
    readonly kernelName: string;
    edge(curve: ICurve): IEdge;
    face(wire: IWire[]): Result<IFace>;
    faceFromSurface(wires: IWire[], sourceFace: IFace): Result<IFace>;
    bezier(points: XYZLike[], weights?: number[]): Result<IEdge>;
    point(point: XYZLike): Result<IVertex>;
    line(start: XYZLike, end: XYZLike): Result<IEdge>;
    arc(normal: XYZLike, center: XYZLike, start: XYZLike, angle: number): Result<IEdge>;
    circle(normal: XYZLike, center: XYZLike, radius: number): Result<IEdge>;
    rect(plane: Plane, dx: number, dy: number): Result<IFace>;
    polygon(points: XYZLike[]): Result<IWire>;
    ellipse(
        normal: XYZLike,
        center: XYZLike,
        xvec: XYZLike,
        majorRadius: number,
        minorRadius: number,
    ): Result<IEdge>;
    wire(edges: IEdge[]): Result<IWire>;
    fuse(bottom: IShape, top: IShape): Result<IShape>;
    combine(shapes: IShape[]): Result<ICompound>;
    fillet(shape: IShape, edges: number[], radius: number): Result<IShape>;
    chamfer(shape: IShape, edges: number[], distance: number): Result<IShape>;
    fillet2d(face: IFace, edge1: IEdge, edge2: IEdge, radius: number): Result<IFace>;
    chamfer2d(face: IFace, edge1: IEdge, edge2: IEdge, distance: number): Result<IFace>;
    filletEdge2d(edge1: IEdge, edge2: IEdge, radius: number): Result<IEdge[]>;
    chamferEdge2d(edge1: IEdge, edge2: IEdge, distance: number): Result<IEdge[]>;
    removeSubShape(shape: IShape, subShapes: IShape[]): Result<IShape>;
    replaceSubShapes(shape: IShape, oldSubShapes: IShape[], newSubShapes: IShape[]): Result<IShape>;
    simplifyShape(
        shape: IShape,
        removeEdges: boolean,
        removeFaces: boolean,
        keepShapes: IShape[],
        linearTolerance?: number,
        angleTolerance?: number,
    ): Result<IShape>;
}
