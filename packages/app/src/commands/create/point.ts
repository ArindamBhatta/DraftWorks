import { command, type GeometryNode, type IStep, PointStep } from "@chili3d/core";
import { PointNode } from "../../bodys";
import { CreateCommand } from "../createCommand";

@command({
    key: "create.point",
    icon: "icon-point",
})
export class Point extends CreateCommand {
    protected override geometryNode(): GeometryNode {
        return new PointNode({ document: this.document, position: this.stepDatas[0].point! });
    }

    getSteps(): IStep[] {
        return [new PointStep("prompt.pickPoint")];
    }
}
