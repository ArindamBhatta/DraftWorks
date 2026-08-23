import type { IDisposable } from "../foundation";
import type { BoundingBox, Matrix4 } from "../math";
import type { INode } from "../model";
import type { IShapeFilter } from "../selectionFilter";
import type { EdgeMeshData, MeshLike, ShapeMeshData } from "../shape";
import type { IVisualObject } from "./visualObject";

export type MeshOption = {
    meshOpacity?: number;
    lineOpacity?: number;
    vertexOpacity?: number;
    /** Draw on top of everything else, ignoring depth (e.g. for a preview/overlay that must always stay visible). */
    onTop?: boolean;
};

/**
 * `IVisualContext` is the contract for the actual 3D scene ("world") one `IVisual` renders — the
 * live collection of everything currently drawn, plus the operations needed to keep it in sync
 * with the document model and to feed it the tessellated mesh data produced by `shape/meshData.ts`.
 * A concrete renderer (e.g. three.js) implements this; `core` only depends on the interface.
 */
export interface IVisualContext extends IDisposable {
    get shapeCount(): number;

    // --- Object lifecycle: keeping the scene in sync with the document tree -------------------
    addVisualObject(object: IVisualObject): void;
    removeVisualObject(object: IVisualObject): void;
    /** Creates/removes the visual representation for document model nodes (the usual entry point — e.g. when a shape is created or deleted). */
    addNode(nodes: INode[]): void;
    removeNode(nodes: INode[]): void;
    /**
     * Bridges the abstract document model and the concrete rendered objects, in both directions —
     * needed constantly: clicking a triangle in 3D needs `getNode` to resolve which model node was
     * hit for selection; selecting a node in a tree view needs `getVisual` to highlight it in 3D.
     */
    getVisual(node: INode): IVisualObject | undefined;
    getNode(visual: IVisualObject): INode | undefined;
    redrawNode(nodes: INode[]): void;
    setVisible(node: INode, visible: boolean): void;
    /**
     * Re-applies every layer's colour, on/off state and lock to the objects on it.
     * Call after changing which layer a node belongs to.
     */
    refreshLayerStyling(): void;
    visuals(): IVisualObject[];

    // --- Spatial queries -------------------------------------------------------------------------
    /** Finds visual objects whose bounding box intersects `boundingBox` — the core of window/box-select, optionally narrowed by an `IShapeFilter` (e.g. "only faces"). */
    boundingBoxIntersectFilter(boundingBox: BoundingBox, filter?: IShapeFilter): IVisualObject[];

    // --- Raw mesh display: feeding it the tessellated buffers from shape/meshData.ts -------------
    /** Displays a batch of tessellated `ShapeMeshData` (faces/edges/vertices) and returns an id to reference it later (e.g. to recolor or remove it). */
    displayMesh(datas: ShapeMeshData[], meshOption?: MeshOption): number;
    setMeshColor(id: number, color: number): void;
    removeMesh(id: number): void;
    /**
     * Draws the SAME mesh many times, once per matrix in `matrixs`, using GPU instancing in a
     * single draw call — the performance-critical path for repeated geometry (e.g. a bolt pattern
     * or an array/rectangular-pattern command result), avoiding one draw call per copy.
     */
    displayInstancedMesh(data: MeshLike, matrixs: Matrix4[], meshOption?: MeshOption): number;
    /** Draws edge/line data produced by an `EdgeMeshDataBuilder` (see `shape/meshData.ts`). */
    displayLineSegments(data: EdgeMeshData): number;
    /** Fast-path updates to an already-displayed mesh, without rebuilding it from scratch (e.g. live dragging). */
    setPosition(id: number, position: Float32Array): void;
    setInstanceMatrix(id: number, matrixs: Matrix4[]): void;
}
