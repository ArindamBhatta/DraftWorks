import {
    command,
    Dimensions,
    type GeometryNode,
    type IStep,
    type PointSnapData,
    PointStep,
    Precision,
    type XYZ,
} from "@chili3d/core";
import { RayNode } from "../../bodys/ray";
import { CreateCommand } from "../createCommand";

// A Ray is picked the same way as a Line - origin, then a through-point - but
// the resulting edge is stretched to RAY_LENGTH past the through-point so it
// reads as "infinite" in one direction, the way AutoCAD's RAY command behaves.
// The geometry kernel has no true infinite-edge primitive (see bodys/ray.ts),
// so this is a practical stand-in: long enough to run off the edge of the
// viewport at any sensible zoom, while staying short enough not to distort
// zoom-to-fit/grid sizing for ordinary drawings (fitContent frames the whole
// drawing, ray included - see cameraController.ts).
const RAY_LENGTH = 100_000;

@command({
    key: "create.ray",
    icon: "icon-arrows",
})
export class Ray extends CreateCommand {
    protected override geometryNode(): GeometryNode {
        const start = this.stepDatas[0].point!;
        const through = this.stepDatas[1].point!;
        const direction = through.sub(start).normalize()!;
        return new RayNode({
            document: this.document,
            start,
            end: start.add(direction.multiply(RAY_LENGTH)),
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
            preview: this.rayPreview,
        };
    };

    private readonly rayPreview = (point: XYZ | undefined) => {
        const start = this.stepDatas[0].point!;
        if (!point) {
            return [this.meshPoint(start)];
        }
        const direction = point.sub(start).normalize();
        const end = direction ? start.add(direction.multiply(RAY_LENGTH)) : point;
        return [this.meshPoint(start), this.meshLine(start, end)];
    };
}
