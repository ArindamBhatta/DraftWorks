import { VisualConfig } from "../../config";
import type { IDocument } from "../../document";
import { type IView, ViewUtils } from "../../visual";
import type { SnapResult, SnapType } from "../snap";
import { Axis } from "./axis";
import { TrackingBase } from "./trackingBase";

export interface ObjectTrackingAxis {
    axes: Axis[];
    snapType: SnapType;
    objectName: string | undefined;
}

interface SnapeInfo {
    snap: SnapResult;
    shapeId: number;
}

/**
 * Whether two snaps are the cursor sitting on one and the same thing - the same kind of
 * point in the same place. Exported for testing.
 *
 * Both halves are needed. Without the point, a hover never completes; without the type,
 * an endpoint and the "nearest point on curve" that shares its position would read as
 * one hover, and resting on a line's end would acquire nothing while the cursor slid
 * between the two.
 */
export function isSameTrackingTarget(current?: SnapResult, next?: SnapResult): boolean {
    if (!current?.point || !next?.point) return false;
    return current.type === next.type && current.point.isEqualTo(next.point);
}

export class ObjectTracking extends TrackingBase {
    private timer?: number;
    private snapping?: SnapResult;
    private readonly trackings: Map<IDocument, SnapeInfo[]> = new Map();

    constructor(trackingZ: boolean) {
        super(trackingZ);
    }

    override clear(): void {
        this.clearTimer();
        super.clear();
        this.trackings.clear();
    }

    getTrackingRays(view: IView) {
        const result: ObjectTrackingAxis[] = [];
        this.trackings.get(view.document)?.map((x) => {
            const plane = ViewUtils.ensurePlane(view, view.workplane);
            const axes = Axis.getAxiesAtPlane(x.snap.point!, plane, this.trackingZ);
            result.push({ axes, objectName: x.snap.info, snapType: x.snap.type });
        });
        return result;
    }

    /**
     * AutoCAD's point acquisition: rest on a key point and it starts tracking from
     * there, so alignment paths radiate from it for the rest of the pick. Hovering an
     * acquired point again drops it.
     *
     * "The same point" is what it looks like on screen, not the object the snap arrived
     * in: every pointer move builds a fresh SnapResult, so comparing the objects made
     * every move look like a move to somewhere new. The timer was cleared and restarted
     * each time, and only a mouse held perfectly still for 600ms ever acquired anything
     * - a hand that drifts a pixel while hovering an endpoint, which is every hand,
     * acquired nothing at all. Comparing the points instead lets one hover run its 600ms
     * out while the cursor stays on the point, and stops a hover that is still sitting
     * there from immediately dropping what it just acquired.
     */
    showTrackingAtTimeout(document: IDocument, snap?: SnapResult) {
        if (isSameTrackingTarget(this.snapping, snap)) return;

        this.clearTimer();
        this.snapping = snap;
        if (!snap || snap.type === "nearCurve" || snap.type === "onSurface") return;
        this.timer = window.setTimeout(() => this.switchTrackingPoint(document, snap), 600);
    }

    private clearTimer() {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    private switchTrackingPoint(document: IDocument, snap: SnapResult) {
        if (this.isCleared || snap.shapes.length === 0) return;
        if (!this.trackings.has(document)) {
            this.trackings.set(document, []);
        }
        const currentTrackings = this.trackings.get(document)!;
        const existingTracking = currentTrackings.find((x) => x.snap.point!.isEqualTo(snap.point!));
        existingTracking
            ? this.removeTrackingPoint(document, existingTracking, currentTrackings)
            : this.addTrackingPoint(snap, document, currentTrackings);
        document.visual.update();
    }

    private removeTrackingPoint(document: IDocument, s: SnapeInfo, snaps: SnapeInfo[]) {
        document.visual.context.removeMesh(s.shapeId);
        this.trackings.set(
            document,
            snaps.filter((x) => x !== s),
        );
    }

    private addTrackingPoint(snap: SnapResult, document: IDocument, snaps: SnapeInfo[]) {
        const pointId = this.displayPoint(
            document,
            snap,
            VisualConfig.trackingVertexSize,
            VisualConfig.trackingVertexColor,
        );
        snaps.push({ shapeId: pointId, snap });
    }
}
