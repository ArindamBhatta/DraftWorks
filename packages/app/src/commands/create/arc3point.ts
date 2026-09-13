import {
    command,
    Dimensions,
    type GeometryNode,
    type IStep,
    type PointSnapData,
    PointStep,
    Precision,
    type ShapeMeshData,
    type XYZ,
} from "@draftworks/core";
import { ArcNode } from "../../bodys/arc";
import { type ArcMode, ArcModeCommand } from "./arcMode";
import { computeArcFromPoints } from "./arcUtils";

@command({
    key: "create.arc3point",
    icon: "icon-arc3point",
})
export class Arc3Point extends ArcModeCommand {
    protected override get ownMode(): ArcMode {
        return "option.command.arcMode.threePoint";
    }

    getSteps(): IStep[] {
        return [
            // The first prompt carries `[C/2P]` - see ArcModeCommand.
            new PointStep("prompt.pickFistPoint", this.getModeStartData),
            new PointStep("prompt.pickArcMid", this.getMidPointData),
            new PointStep("prompt.pickArcEnd", this.getEndPointData),
        ];
    }

    private readonly getMidPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimensions.D1D2D3,
            validator: (point: XYZ) => {
                return this.stepDatas[0].point!.distanceTo(point) > Precision.Distance;
            },
            preview: this.midPreview,
        };
    };

    private readonly getEndPointData = (): PointSnapData => {
        const [p1, p2] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        return {
            validator: (p: XYZ) => {
                if (p.distanceTo(p1) < Precision.Distance) return false;
                if (p.distanceTo(p2) < Precision.Distance) return false;
                const AB = p2.sub(p1);
                const AC = p.sub(p1);
                return AB.cross(AC).length() > 1e-10;
            },
            preview: (end: XYZ | undefined) => this.arcPreview(p1, p2, end),
        };
    };

    private readonly midPreview = (point: XYZ | undefined) => {
        const p1 = this.stepDatas[0].point!;
        if (!point) return [this.meshPoint(p1)];
        return [this.meshPoint(p1), this.meshPoint(point), this.meshLine(p1, point)];
    };

    private readonly arcPreview = (p1: XYZ, p2: XYZ, end: XYZ | undefined) => {
        const result: ShapeMeshData[] = [this.meshPoint(p1), this.meshPoint(p2)];
        if (!end) return result;
        result.push(this.meshPoint(end));
        const geometry = computeArcFromPoints(p1, p2, end);
        if (geometry && Math.abs(geometry.angle) > Precision.Angle) {
            result.push(
                this.meshCreatedShape(
                    "arc",
                    geometry.normal,
                    geometry.center,
                    geometry.start,
                    geometry.angle,
                ),
            );
        }
        return result;
    };

    protected override geometryNode(): GeometryNode {
        const [p1, p2, p3] = [this.stepDatas[0].point!, this.stepDatas[1].point!, this.stepDatas[2].point!];
        const geometry = computeArcFromPoints(p1, p2, p3)!;
        return new ArcNode({
            document: this.document,
            normal: geometry.normal,
            center: geometry.center,
            start: geometry.start,
            angle: geometry.angle,
        });
    }
}
