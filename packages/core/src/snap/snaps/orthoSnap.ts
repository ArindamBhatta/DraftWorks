import { Config, VisualConfig } from "../../config";
import { I18n } from "../../i18n";
import { MathUtils, Plane, type XYZ } from "../../math";
import { MeshDataUtils } from "../../shape";
import { type IView, ViewUtils } from "../../visual";
import type { ISnap, MouseAndDetected, SnapResult } from "../snap";

/**
 * AutoCAD-style ORTHO mode (the status bar toggle): locks the point being picked to
 * whichever workplane axis - X or Y - runs through the reference point, so every
 * segment comes out horizontal or vertical. The axis the cursor has travelled
 * furthest along wins, which is how AutoCAD decides too.
 *
 * This snap is registered ahead of the object/tracking snaps so that, while ortho is
 * on, it overrides them: the point of the mode is that the result is straight no
 * matter what geometry happens to lie under the cursor.
 */
export class OrthoSnap implements ISnap {
    private _tempLine?: [IView, number];

    constructor(
        readonly refPoint: () => XYZ | undefined,
        readonly plane?: (point: XYZ) => Plane,
    ) {}

    snap(data: MouseAndDetected): SnapResult | undefined {
        if (!Config.instance.enableOrtho) return undefined;

        const refPoint = this.refPoint();
        if (!refPoint) return undefined;

        const basePlane = this.plane?.(data.view.screenToWorld(data.mx, data.my)) ?? data.view.workplane;
        const cursor = this.cursorAt(data, refPoint, basePlane);
        if (!cursor) return undefined;

        const vector = cursor.sub(refPoint);
        const alongX = vector.dot(basePlane.xvec);
        const alongY = vector.dot(basePlane.yvec);
        const useX = Math.abs(alongX) >= Math.abs(alongY);
        const direction = useX ? basePlane.xvec : basePlane.yvec;
        const distance = useX ? alongX : alongY;

        this.showTempLine(data.view, refPoint, direction, distance);

        return {
            view: data.view,
            point: refPoint.add(direction.multiply(distance)),
            refPoint,
            distance: Math.abs(distance),
            info: I18n.translate(useX ? "axis.x" : "axis.y"),
            shapes: [],
            type: "axis",
        };
    }

    /**
     * Where the cursor lands on the plane parallel to the workplane that passes through
     * the reference point. ensurePlane covers the edge-on case, where that plane is
     * invisible to the camera and a screen-facing substitute has to be used instead -
     * the axis projection below puts the result back on the axis either way.
     */
    private cursorAt(data: MouseAndDetected, refPoint: XYZ, basePlane: Plane) {
        const plane = new Plane({ origin: refPoint, normal: basePlane.normal, xvec: basePlane.xvec });
        return ViewUtils.ensurePlane(data.view, plane).intersectRay(data.view.rayAt(data.mx, data.my));
    }

    private showTempLine(view: IView, refPoint: XYZ, direction: XYZ, distance: number) {
        const length = MathUtils.almostEqual(distance, 0) ? 1e15 : 1e15 * distance;
        const lineData = MeshDataUtils.createEdgeMesh(
            refPoint,
            refPoint.add(direction.multiply(length)),
            VisualConfig.temporaryEdgeColor,
            "dash",
        );
        this._tempLine = [view, view.document.visual.context.displayMesh([lineData])];
    }

    removeDynamicObject(): void {
        if (!this._tempLine) return;

        const [view, id] = this._tempLine;
        this._tempLine = undefined;
        view.document.visual.context.removeMesh(id);
    }

    clear(): void {
        this.removeDynamicObject();
    }
}
