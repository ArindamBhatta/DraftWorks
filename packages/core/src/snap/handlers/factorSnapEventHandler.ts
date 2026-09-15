import { Config } from "../../config";
import type { IDocument } from "../../document";
import { type AsyncController, Precision } from "../../foundation";
import type { XYZ } from "../../math";
import type { IView } from "../../visual";
import type { SnapResult } from "../snap";
import { ObjectSnap, WorkplaneSnap } from "../snaps";
import { TrackingSnap } from "../tracking";
import type { PointSnapData } from "./pointSnapEventHandler";
import { SnapEventHandler } from "./snapEventHandler";

/**
 * The pick behind SCALE's factor prompt, where a typed number is a multiplier rather
 * than a length.
 *
 * PointSnapEventHandler cannot serve this prompt, because there a typed `2` means
 * "two drawing units along the direction the cursor happens to be pointing" - and
 * when the cursor has not moved since the base point was picked there is no such
 * direction, so it silently yields the base point itself and scales everything to
 * nothing. Here `2` means "twice as big" with no cursor involved at all, which is
 * also what lets a typed factor and a picked factor mean the same thing.
 *
 * The factor is carried back as a point one factor-length from the base along the
 * base direction, so the command reads it with the same `distanceTo(base)` it uses
 * for a picked point.
 */
export class FactorSnapEventHandler extends SnapEventHandler<PointSnapData> {
    constructor(
        document: IDocument,
        controller: AsyncController,
        private readonly base: () => XYZ,
        snapPointData: PointSnapData,
    ) {
        const objectSnap = new ObjectSnap(Config.instance.snapType, snapPointData.refPoint);
        const trackingSnap = new TrackingSnap(base, false);
        const workplaneSnap = new WorkplaneSnap(snapPointData.refPoint);
        super(document, controller, [objectSnap, trackingSnap, workplaneSnap], snapPointData);

        snapPointData.prompt ??= this.formatFactorPrompt;
    }

    /**
     * A factor is a bare multiplier, so it is shown as one - running it through
     * UnitSetup the way a distance prompt does would render "2" as `0'-2"`.
     */
    private readonly formatFactorPrompt = (snaped?: SnapResult) => {
        if (!snaped?.point) return "";
        return `${snaped.point.distanceTo(this.base()).toFixed(4)} x`;
    };

    /**
     * Dynamic input measures distances in drawing units, which a factor is not, so the
     * boxes stay down for this prompt and a typed number reaches the command line.
     */
    protected override dynamicInputPlane() {
        return undefined;
    }

    protected override inputError(text: string) {
        const factor = Number.parseFloat(text);
        if (Number.isNaN(factor)) return "error.input.invalidNumber";
        // A zero or negative factor would collapse or mirror the selection rather than
        // resize it, which is what AutoCAD rejects here too.
        if (factor <= Precision.Distance) return "error.input.invalidNumber";
        return undefined;
    }

    protected override getPointFromInput(view: IView, text: string): SnapResult {
        const factor = Number.parseFloat(text);
        const base = this.base();
        const direction = this.document.application.activeView?.workplane.xvec ?? view.workplane.xvec;
        return {
            point: base.add(direction.multiply(factor)),
            view,
            shapes: [],
            type: "input",
            refPoint: base,
        };
    }
}
