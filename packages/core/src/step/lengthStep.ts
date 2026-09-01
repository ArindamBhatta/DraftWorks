import type { IDocument } from "../document";
import { type AsyncController, Precision } from "../foundation";
import type { XYZ } from "../math";
import {
    type LengthAtAxisSnapData,
    SnapLengthAtAxisHandler,
    type SnapLengthAtPlaneData,
    SnapLengthAtPlaneHandler,
} from "../snap";
import { SnapStep } from "./step";
// The LengthAtAxisStep and LengthAtPlaneStep classes are specialized SnapSteps that are used for snapping to a specific length along an axis or within a plane, respectively. They allow the user to select a point that defines the length, while ensuring that the selected point is not too close to the reference point (the axis or plane) to avoid precision issues.
export class LengthAtAxisStep extends SnapStep<LengthAtAxisSnapData> {
    protected getEventHandler(document: IDocument, controller: AsyncController, data: LengthAtAxisSnapData) {
        return new SnapLengthAtAxisHandler(document, controller, data);
    }

    protected validator(data: LengthAtAxisSnapData, point: XYZ): boolean {
        return Math.abs(point.sub(data.point).dot(data.direction)) > Precision.Distance;
    }
}

export class LengthAtPlaneStep extends SnapStep<SnapLengthAtPlaneData> {
    protected getEventHandler(document: IDocument, controller: AsyncController, data: SnapLengthAtPlaneData) {
        return new SnapLengthAtPlaneHandler(document, controller, data);
    }

    protected validator(data: SnapLengthAtPlaneData, point: XYZ): boolean {
        const pointAtPlane = data.plane(point).project(point);
        return pointAtPlane.distanceTo(data.point()) > Precision.Distance;
    }
}
