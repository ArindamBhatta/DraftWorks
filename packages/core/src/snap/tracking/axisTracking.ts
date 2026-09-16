import { I18n } from "../../i18n";
import type { Plane, XYZ } from "../../math";
import type { IView } from "../../visual";
import { Axis } from "./axis";
import { TrackingBase } from "./trackingBase";

/**
 * The alignment rays running out of the command's reference point - AutoCAD's polar
 * tracking. With no angle given these are just the workplane's own axes; with one, a ray
 * every `angle` degrees all the way round, which is what turns "horizontal and vertical"
 * into "every 15°, 30°, 45°...".
 *
 * The rays are cached per view because they only depend on the workplane and the
 * reference point, and are rebuilt by `clear()` - which TrackingSnap calls whenever the
 * polar settings change, since the cache cannot tell that the angle it was built with is
 * no longer the one configured.
 */
export class AxisTracking extends TrackingBase {
    private readonly axies: Map<IView, Axis[]> = new Map();

    constructor(trackingZ: boolean) {
        super(trackingZ);
    }

    getAxes(view: IView, referencePoint: XYZ, angles: number[] | undefined = undefined) {
        if (!this.axies.has(view)) {
            this.axies.set(view, this.initAxes(view.workplane, referencePoint, angles));
        }
        return this.axies.get(view)!;
    }

    private initAxes(plane: Plane, referencePoint: XYZ, angles: number[] | undefined): Axis[] {
        // A step of zero never terminates the loop below and a tiny one buries the view
        // in rays that are all within snapping distance of each other, so anything that
        // is not a usable increment is dropped. Config sanitises what the UI can set;
        // this guards the callers that do not go through it. Nothing usable left - or no
        // list at all - falls back to the plain workplane axes.
        const steps = (angles ?? []).filter((a) => Number.isFinite(a) && a >= 1);
        if (steps.length === 0) {
            return Axis.getAxiesAtPlane(referencePoint, plane, this.trackingZ);
        }

        // The union over every increment, deduplicated: [90, 45] must not offer the four
        // axes twice over, since a duplicated ray is a second tracking hit at the same
        // place and TrackingSnap reads two hits as an intersection to snap to.
        const degrees = new Set<number>();
        for (const step of steps) {
            for (let testAngle = 0; testAngle < 360; testAngle += step) {
                // Rounded before it is used as the key: 22.5 accumulates float error, and
                // two rays that differ in the 12th decimal are two rays to the Set and
                // one to the eye.
                degrees.add((Math.round(testAngle * 1e6) / 1e6) % 360);
            }
        }

        const result = [...degrees]
            .sort((a, b) => a - b)
            .map((degree) => {
                const direction = plane.xvec.rotate(plane.normal, (degree / 180) * Math.PI)!;
                // "Polar: 45°", the way AutoCAD labels the tooltip on an alignment path,
                // so a ray that happens to lie along X reads as a polar hit rather than
                // an axis one - the difference between "this is only offered" and ortho's
                // "this is forced".
                return new Axis(referencePoint, direction, I18n.translate("snap.polarAt{0}", degree));
            });

        if (this.trackingZ) {
            result.push(new Axis(referencePoint, plane.normal, I18n.translate("axis.z")));
            result.push(new Axis(referencePoint, plane.normal.reverse(), I18n.translate("axis.z")));
        }

        return result;
    }

    override clear(): void {
        super.clear();
        this.axies.clear();
    }
}
