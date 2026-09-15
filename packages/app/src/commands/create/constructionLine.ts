import {
    command,
    Dimensions,
    type GeometryNode,
    type IStep,
    type PointSnapData,
    PointStep,
    Precision,
    type XYZ,
} from "@draftworks/core";

import { ConstructionLineNode } from "../../bodys";

import { CreateCommand } from "../createCommand";

// A construction line is picked the same way as a Line - origin, then a
// through-point - but the resulting edge is stretched RAY_LENGTH past *both*
// ends so it reads as "infinite" in both directions, the way AutoCAD's XLINE
// command behaves. The geometry kernel has no true infinite-edge primitive
// (see bodys/constructionLine.ts), so this is a practical stand-in: long
// enough to run off the edge of the viewport at any sensible zoom, while
// staying short enough not to distort zoom-to-fit/grid sizing for ordinary
// drawings (fitContent frames the whole drawing, construction line included -
// see cameraController.ts).

const constructionLineLength = 1000000; // 1 million mm, or 1 km, or 3,280 feet - long enough to run off the edge of the viewport at any sensible zoom

@command({
    key: "create.constructionLine",
    icon: "icon-constructionLine",
})
export class ConstructionLine extends CreateCommand {
    protected override geometryNode(): GeometryNode {
        const first = this.stepDatas[0].point!;
        const through = this.stepDatas[1].point!;
        const direction = through.sub(first).normalize()!;
        return new ConstructionLineNode({
            document: this.document,
            start: first.sub(direction.multiply(constructionLineLength)),
            end: first.add(direction.multiply(constructionLineLength)),
        });
    }

    protected override executeMainTask(): void {
        super.executeMainTask();
        this.repeatOperation = true;
    }

    getSteps(): IStep[] {
        const firstStep = new PointStep("prompt.pickFistPoint");
        const secondStep = new PointStep("prompt.pickNextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimensions.D1D2D3,
            validator: (point: XYZ) => {
                return this.stepDatas[0].point!.distanceTo(point) > Precision.Distance;
            },
            preview: this.linePreview,
        };
    };

    private readonly linePreview = (point: XYZ | undefined) => {
        const first = this.stepDatas[0].point!;
        if (!point) {
            return [this.meshPoint(first)];
        }
        const direction = point.sub(first).normalize();
        if (!direction) return [this.meshPoint(first)];
        const start = first.sub(direction.multiply(constructionLineLength));
        const end = first.add(direction.multiply(constructionLineLength));
        return [this.meshPoint(first), this.meshLine(start, end)];
    };
}
