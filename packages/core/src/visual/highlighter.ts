import type { ShapeMeshData, ShapeType } from "../shape";
import type { IVisualObject } from "./visualObject";
import type { VisualState } from "./visualShape";

export interface IHighlighter {
    getState(shape: IVisualObject, type: ShapeType, index?: number): VisualState | undefined;
    clear(): void;
    resetState(shape: IVisualObject): void;
    addState(shape: IVisualObject, state: VisualState, type: ShapeType, ...index: number[]): void;
    removeState(shape: IVisualObject, state: VisualState, type: ShapeType, ...index: number[]): void;
    highlightMesh(...datas: ShapeMeshData[]): number;
    removeHighlightMesh(id: number): void;
}
