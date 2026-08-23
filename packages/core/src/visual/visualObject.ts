import type { IDisposable } from "../foundation/disposable";
import type { BoundingBox } from "../math/boundingBox";
import type { Matrix4 } from "../math/matrix4";
import type { GeometryNode } from "../model/geometryNode";
import type { VisualNode } from "../model/visualNode";

export interface IVisualObject extends IDisposable {
    locked: boolean;
    visible: boolean;
    transform: Matrix4;
    worldTransform(): Matrix4;
    boundingBox(): BoundingBox | undefined;
}

export interface INodeVisual extends IVisualObject {
    get node(): VisualNode;
}

export interface IVisualGeometry extends IVisualObject {
    get geometryNode(): GeometryNode;
}

export function isVisualGeometry(obj: IVisualObject): obj is IVisualGeometry {
    return (obj as IVisualGeometry).geometryNode !== undefined;
}
