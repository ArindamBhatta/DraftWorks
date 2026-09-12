import { command, type IEdge, type IFace, type IShape, property, type Result } from "@draftworks/core";
import { EdgeCornerCommand } from "./edgeCornerCommand";

@command({
    key: "modify.chamfer",
    icon: "icon-chamfer",
})
export class ChamferCommand extends EdgeCornerCommand {
    @property("common.length")
    get length() {
        return this.getPrivateValue("length", 10);
    }

    set length(value: number) {
        this.setProperty("length", value);
    }

    protected override applyToBody(shape: IShape, edgeIndexes: number[]): Result<IShape> {
        return shapeFactory.chamfer(shape, edgeIndexes, this.length);
    }

    protected override applyToFace(face: IFace, edge1: IEdge, edge2: IEdge): Result<IShape> {
        return shapeFactory.chamfer2d(face, edge1, edge2, this.length);
    }

    protected override applyToEdgePair(edge1: IEdge, edge2: IEdge): Result<IEdge[]> {
        return shapeFactory.chamferEdge2d(edge1, edge2, this.length);
    }
}
