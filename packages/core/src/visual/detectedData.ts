import type { Matrix4, XYZ } from "../math";
import type { IShape } from "../shape";
import type { INodeVisual } from "./visualObject";

export interface VisualShapeData {
    shape: IShape;
    owner: INodeVisual;
    transform: Matrix4;
    point?: XYZ;
    indexes: number[];
}
