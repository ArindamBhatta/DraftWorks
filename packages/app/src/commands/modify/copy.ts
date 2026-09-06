import { command, Dimensions, type Matrix4, type PointSnapData, PointStep, type XYZ } from "@chili3d/core";
import { TransformedCommand } from "./transformedCommand";

@command({
    key: "modify.copy",
    icon: "icon-copy",
})
export class Copy extends TransformedCommand {
    #displacementMode = false;

    getSteps() {
        if (this.#displacementMode) {
            return [new PointStep("prompt.copy.displacement", this.getDisplacementData, true)];
        }
        return [
            new PointStep("prompt.copy.basePoint", this.getBasePointData, true),
            new PointStep("prompt.copy.secondPoint", this.getSecondPointData, true),
        ];
    }

    private readonly getDisplacementData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        preview: (point: XYZ | undefined) => (point ? [this.transformPreview(point)] : []),
    });

    private readonly getBasePointData = (): PointSnapData => ({});

    private readonly getSecondPointData = (): PointSnapData => {
        return {};
    };

    protected override transfrom(p2: XYZ): Matrix4 {
        throw new Error("Method not implemented.");
    }
}
