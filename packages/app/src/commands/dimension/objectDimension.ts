import {
    command,
    Dimensions,
    type DimensionType,
    type IStep,
    type PointSnapData,
    PointStep,
    SelectShapeStep,
    ShapeTypes,
    type XYZ,
} from "@draftworks/core";
import { DimensionCommandBase } from "./dimensionCommand";
import { pickedEdgeGeometry } from "./pickedEdge";

/**
 * AutoCAD's DIM: point at an object, get the right dimension for it. This is the answer
 * to "I want the exact size" - the origins are read straight off the picked curve rather
 * than from two pointer positions, so the value is the object's real length or radius no
 * matter how precisely the two picks land.
 *
 * The kind follows the geometry: a circle or arc is dimensioned radially, anything else
 * gets an aligned dimension across its true endpoints.
 */
@command({
    key: "dimension.object",
    icon: "icon-measureLength",
})
export class ObjectDimension extends DimensionCommandBase {
    protected override get dimensionType(): DimensionType {
        return pickedEdgeGeometry(this.stepDatas[0])?.circle ? "radius" : "aligned";
    }

    protected override dimensionInput() {
        const geometry = pickedEdgeGeometry(this.stepDatas[0]);
        if (!geometry) return undefined;

        if (geometry.circle) {
            return {
                start: geometry.circle.center,
                end: geometry.circle.center,
                radius: geometry.circle.radius,
            };
        }
        return { start: geometry.start, end: geometry.end };
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeTypes.edge, "prompt.dimension.selectObject"),
            new PointStep("prompt.dimension.linePosition", this.offsetData),
        ];
    }

    /**
     * The frame comes from the active view: the first step selects a shape, so unlike
     * the point-picked dimension commands it carries no workplane of its own.
     */
    protected override frame() {
        const workplane = this.application.activeView!.workplane;
        return { normal: workplane.normal, xAxis: workplane.xvec };
    }

    private readonly offsetData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        preview: (point: XYZ | undefined) => this.previewDimension(point),
    });
}
