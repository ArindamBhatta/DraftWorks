import type { IDocument } from "../document";
import { type AsyncController, Precision } from "../foundation";
import type { XYZ } from "../math";
import { AngleSnapEventHandler, Dimensions, type PointSnapData } from "../snap";
import { SnapStep, type StepTip } from "./step";

function defaultSnappedData(): PointSnapData {
    return {
        dimension: Dimensions.D1D2D3,
    };
}
// The AngleStep is a specialized SnapStep that is used for snapping to an angle defined by a center point and a first point. It allows the user to select a second point that defines the angle, while ensuring that the second point is not too close to the reference point (the first point) to avoid precision issues.
export class AngleStep extends SnapStep<PointSnapData> {
    constructor(
        tip: StepTip,
        private readonly handleCenter: () => XYZ,
        private readonly handleP1: () => XYZ,
        handleP2Data: () => PointSnapData = defaultSnappedData,
        keepSelected = false,
    ) {
        super(tip, handleP2Data, keepSelected);
    }

    protected getEventHandler(document: IDocument, controller: AsyncController, data: PointSnapData) {
        return new AngleSnapEventHandler(document, controller, this.handleCenter, this.handleP1(), data);
    }

    protected validator(data: PointSnapData, point: XYZ): boolean {
        return data.refPoint === undefined || data.refPoint().distanceTo(point) > Precision.Distance;
    }
}
