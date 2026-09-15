import type { IDocument } from "../document";
import { type AsyncController, Precision } from "../foundation";
import type { XYZ } from "../math";
import { Dimensions, FactorSnapEventHandler, type PointSnapData } from "../snap";
import { SnapStep, type StepTip } from "./step";

function defaultSnappedData(): PointSnapData {
    return { dimension: Dimensions.D1D2D3 };
}

/**
 * The step behind SCALE's factor prompt: a pick whose typed value is a multiplier,
 * not a length. See FactorSnapEventHandler for why a plain PointStep cannot do this.
 */
export class FactorStep extends SnapStep<PointSnapData> {
    constructor(
        tip: StepTip,
        private readonly handleBase: () => XYZ,
        handleData: () => PointSnapData = defaultSnappedData,
        keepSelected = false,
    ) {
        super(tip, handleData, keepSelected);
    }

    protected getEventHandler(document: IDocument, controller: AsyncController, data: PointSnapData) {
        return new FactorSnapEventHandler(document, controller, this.handleBase, data);
    }

    protected validator(data: PointSnapData, point: XYZ): boolean {
        return point.distanceTo(this.handleBase()) > Precision.Distance;
    }
}
