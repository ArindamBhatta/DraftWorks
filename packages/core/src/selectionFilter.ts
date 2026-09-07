import type { Matrix4 } from "./math";
import { type INode, ShapeNode } from "./model";
import type { IShape } from "./shape";

export interface IShapeFilter {
    allow(shape: IShape, transform: Matrix4): boolean;
}

export interface INodeFilter {
    allow(node: INode): boolean;
}

export class ShapeNodeFilter implements INodeFilter {
    constructor(readonly shapeFilter?: IShapeFilter) {}

    allow(node: INode): boolean {
        if (node instanceof ShapeNode) {
            if (this.shapeFilter && node.shape.isOk) {
                return this.shapeFilter.allow(node.shape.value, node.transform);
            }
            return true;
        }

        return false;
    }
}
