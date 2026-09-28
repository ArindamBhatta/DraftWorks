import type { EdgeMeshData, ShapeMeshData, ShapeType } from "../shape";
import type { IVisualObject } from "./visualObject";
import type { VisualState } from "./visualShape";

/**
 * What a click is about to do to an object's line work, in world space: the pieces it
 * will leave, and the stretches it will take away.
 */
export interface LineChange {
    kept: EdgeMeshData[];
    removed: EdgeMeshData[];
}

export interface IHighlighter {
    getState(shape: IVisualObject, type: ShapeType, index?: number): VisualState | undefined;
    clear(): void;
    resetState(shape: IVisualObject): void;
    addState(shape: IVisualObject, state: VisualState, type: ShapeType, ...index: number[]): void;
    removeState(shape: IVisualObject, state: VisualState, type: ShapeType, ...index: number[]): void;
    highlightMesh(...datas: ShapeMeshData[]): number;
    /**
     * Shows `visual` as `change` would leave it, until `removeHighlightMesh` is given the
     * id this returns. The object's own lines are hidden; what is kept is drawn in their
     * place in the object's own look, and what is removed is drawn dotted in the object's
     * colour. That is TRIM's preview, the way AutoCAD shows it: the result, not a
     * recolouring of the line.
     */
    highlightChange(visual: IVisualObject, change: LineChange): number;
    removeHighlightMesh(id: number): void;
}
