// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    Dimensions,
    type DimensionType,
    type IStep,
    type PointSnapData,
    PointStep,
    Precision,
    type XYZ,
} from "@chili3d/core";
import { DimensionCommandBase } from "./dimensionCommand";

/**
 * Both take the same three picks - first extension-line origin, second origin, then
 * where the dimension line goes - and differ only in how the dimension line is
 * oriented, which buildDimensionGeometry handles from the type.
 */
abstract class TwoPointDimension extends DimensionCommandBase {
    protected override dimensionInput() {
        const start = this.stepDatas[0]?.point;
        const end = this.stepDatas[1]?.point;
        if (!start || !end) return undefined;
        return { start, end };
    }

    protected override getSteps(): IStep[] {
        return [
            new PointStep("prompt.dimension.firstOrigin"),
            new PointStep("prompt.dimension.secondOrigin", this.secondPointData),
            new PointStep("prompt.dimension.linePosition", this.offsetPointData),
        ];
    }

    private readonly secondPointData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2D3,
        validator: (point: XYZ) => this.stepDatas[0].point!.distanceTo(point) > Precision.Distance,
        preview: (point: XYZ | undefined) =>
            point
                ? [this.meshPoint(this.stepDatas[0].point!), this.meshLine(this.stepDatas[0].point!, point)]
                : [this.meshPoint(this.stepDatas[0].point!)],
    });

    private readonly offsetPointData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[1].point!,
        dimension: Dimensions.D1D2D3,
        preview: (point: XYZ | undefined) => this.previewDimension(point),
    });
}

/**
 * DIMLINEAR: measures only the horizontal or vertical component of the span. Which one
 * follows the direction the dimension line is dragged, as in AutoCAD.
 */
@command({
    key: "dimension.linear",
    icon: "icon-measureLength",
})
export class LinearDimension extends TwoPointDimension {
    protected override get dimensionType(): DimensionType {
        return "linear";
    }
}

/** DIMALIGNED: measures the true distance, dimension line parallel to the two points. */
@command({
    key: "dimension.aligned",
    icon: "icon-measureLength",
})
export class AlignedDimension extends TwoPointDimension {
    protected override get dimensionType(): DimensionType {
        return "aligned";
    }
}
