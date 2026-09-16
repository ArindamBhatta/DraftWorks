import { Config } from "../../config";
import type { Plane, XYZ } from "../../math";
import { ViewUtils } from "../../visual";
import type { ISnap, MouseAndDetected, SnapResult } from "../snap";

/**
 * AutoCAD's SNAPMODE (F9): rounds the picked point to the nearest multiple of
 * `Config.snapSpacing` along both workplane axes, so the cursor lands on a lattice
 * instead of anywhere it likes.
 *
 * Registered *after* the object, tracking and ortho snaps and *before* the free
 * workplane point, which is what gives it AutoCAD's precedence: a key point on real
 * geometry always wins over the lattice - otherwise turning snap mode on would stop you
 * being able to touch an endpoint that happens to lie off it - but with nothing else
 * caught, the step replaces free movement rather than falling through to it.
 *
 * Not tied to the grid that is drawn. That grid re-picks its spacing from the zoom level
 * (see ThreeGrid), so it has no fixed step to offer; this keeps its own, exactly as
 * AutoCAD keeps SNAPUNIT apart from GRIDUNIT.
 */
export class GridSnap implements ISnap {
    constructor(
        readonly refPoint?: () => XYZ,
        readonly plane?: () => Plane,
    ) {}

    snap(data: MouseAndDetected): SnapResult | undefined {
        if (!Config.instance.enableGridSnap) return undefined;

        const spacing = Config.instance.snapSpacing;
        if (!(spacing > 0)) return undefined;

        const basePlane = ViewUtils.ensurePlane(data.view, this.plane?.() ?? data.view.workplane);
        const cursor = basePlane.intersectRay(data.view.rayAt(data.mx, data.my));
        if (!cursor) return undefined;

        // Rounded in the plane's own coordinates rather than in world XYZ, so the lattice
        // follows the drawing plane's axes and origin instead of the world's. On the
        // default workplane the two coincide; on any other they do not, and a lattice
        // aligned to the wrong axes is worse than none.
        const offset = cursor.sub(basePlane.origin);
        const x = Math.round(offset.dot(basePlane.xvec) / spacing) * spacing;
        const y = Math.round(offset.dot(basePlane.yvec) / spacing) * spacing;
        const point = basePlane.origin.add(basePlane.xvec.multiply(x)).add(basePlane.yvec.multiply(y));

        const refPoint = this.refPoint?.();
        return {
            view: data.view,
            point,
            refPoint,
            distance: refPoint?.distanceTo(point),
            shapes: [],
            type: "onSurface",
        };
    }

    removeDynamicObject(): void {}

    clear(): void {}
}
