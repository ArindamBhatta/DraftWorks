// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CurveUtils,
    command,
    Dimensions,
    type DimensionType,
    type IEdge,
    type IShape,
    type IStep,
    type PointSnapData,
    PointStep,
    SelectShapeStep,
    ShapeTypes,
    type XYZ,
} from "@draftworks/core";
import { DimensionCommandBase } from "./dimensionCommand";
import { pickedEdgeGeometry } from "./pickedEdge";

/** Only circles and arcs can carry a radius or diameter dimension. */
const circularEdges = {
    allow: (shape: IShape) => {
        const edge = shape as IEdge;
        return edge.shapeType === ShapeTypes.edge && CurveUtils.isCircle(edge.curve);
    },
};

/**
 * DIMRADIUS and DIMDIAMETER: pick a circle or arc, then drag the leader out. The
 * selectable set is filtered to circular edges, so there is no way to start one on
 * a line and get a meaningless answer.
 */
abstract class CircularDimension extends DimensionCommandBase {
    protected override dimensionInput() {
        // Exact centre and radius off the picked curve - see pickedEdgeGeometry, which
        // also keeps this from rebuilding the transformed edge on every preview frame.
        const circle = pickedEdgeGeometry(this.stepDatas[0])?.circle;
        if (!circle) return undefined;
        return { start: circle.center, end: circle.center, radius: circle.radius };
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeTypes.edge, "prompt.dimension.selectCircle", {
                shapeFilter: circularEdges,
            }),
            new PointStep("prompt.dimension.leaderPosition", this.leaderData),
        ];
    }

    /**
     * The frame comes from the active view rather than stepDatas[0], because the first
     * step here selects a shape and so carries no workplane of its own.
     */
    protected override frame() {
        const workplane = this.application.activeView!.workplane;
        return { normal: workplane.normal, xAxis: workplane.xvec };
    }

    private readonly leaderData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        preview: (point: XYZ | undefined) => this.previewDimension(point),
    });
}

@command({
    key: "dimension.radius",
    icon: "icon-circle",
})
export class RadiusDimension extends CircularDimension {
    protected override get dimensionType(): DimensionType {
        return "radius";
    }
}

@command({
    key: "dimension.diameter",
    icon: "icon-circle",
})
export class DiameterDimension extends CircularDimension {
    protected override get dimensionType(): DimensionType {
        return "diameter";
    }
}
