import type { SnapPointOnCurveData } from "../handlers";
import type { ISnap, MouseAndDetected, SnapResult } from "../snap";

export class PointOnCurveSnap implements ISnap {
    constructor(readonly pointData: SnapPointOnCurveData) {}

    snap(data: MouseAndDetected): SnapResult | undefined {
        const ray = data.view.rayAt(data.mx, data.my);
        const curve = this.pointData.curve;
        const nearest = curve.nearestExtrema(ray.toLine());
        if (!nearest) return undefined;
        return {
            view: data.view,
            point: nearest.p1,
            shapes: [],
            type: "nearCurve",
        };
    }

    removeDynamicObject(): void {}
    clear(): void {}
}
