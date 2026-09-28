import {
    command,
    Dimensions,
    type DimensionType,
    type IStep,
    type PointSnapData,
    PointStep,
    Precision,
    type ShapeMeshData,
    type XYZ,
} from "@draftworks/core";
import { DimensionCommandBase } from "./dimensionCommand";

/**
 * DIMANGULAR, three-point form: the vertex, a point on each ray, then the radius the
 * dimension arc is drawn at.
 */
@command({
    key: "dimension.angular",
    icon: "icon-measureAngle",
})
export class AngularDimension extends DimensionCommandBase {
    protected override get dimensionType(): DimensionType {
        return "angular";
    }

    protected override dimensionInput() {
        const vertex = this.stepDatas[0]?.point;
        const first = this.stepDatas[1]?.point;
        const second = this.stepDatas[2]?.point;
        if (!vertex || !first || !second) return undefined;
        return { start: vertex, end: first, third: second };
    }

    protected override getSteps(): IStep[] {
        return [
            new PointStep("prompt.dimension.vertex"),
            new PointStep("prompt.dimension.firstRay", this.rayData(0)),
            new PointStep("prompt.dimension.secondRay", this.rayData(0)),
            new PointStep("prompt.dimension.arcPosition", this.arcData),
        ];
    }

    private readonly rayData = (refIndex: number) => (): PointSnapData => ({
        refPoint: () => this.stepDatas[refIndex].point!,
        dimension: Dimensions.D1D2D3,
        validator: (point: XYZ) => this.stepDatas[refIndex].point!.distanceTo(point) > Precision.Distance,
        preview: (point: XYZ | undefined) => {
            const vertex = this.stepDatas[0].point!;
            const meshes: ShapeMeshData[] = [this.meshPoint(vertex)];
            if (this.stepDatas[1]?.point) {
                meshes.push(this.meshLine(vertex, this.stepDatas[1].point));
            }
            if (point) meshes.push(this.meshLine(vertex, point));
            return meshes;
        },
    });

    private readonly arcData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2D3,
        preview: (point: XYZ | undefined) => this.previewDimension(point),
    });
}
