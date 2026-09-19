import { Config, VisualConfig } from "../../config";
import { I18n } from "../../i18n";
import { MathUtils, Plane, type XYZ } from "../../math";
import { MeshDataUtils } from "../../shape";
import { type IView, ViewUtils, worldUnitsPerPixel } from "../../visual";
import type { ISnap, MouseAndDetected, SnapResult } from "../snap";

/**
 * How far off the locked axis an object snap may sit and still be taken, in drawing
 * units per pixel of cursor tolerance. An endpoint is "on the axis" when it is within
 * the same few pixels that every other snap uses to decide the cursor is over it, so
 * the test scales with the zoom rather than fixing a world distance that means
 * something different at every scale.
 */
const ON_AXIS_TOLERANCE_PIXELS = 6;

/**
 * AutoCAD-style ORTHO mode (the status bar toggle): locks the point being picked to
 * whichever workplane axis - X or Y - runs through the reference point, so every
 * segment comes out horizontal or vertical. The axis the cursor has travelled
 * furthest along wins, which is how AutoCAD decides too.
 *
 * Ortho constrains the *direction*, not what may be snapped to along it. So the object
 * snaps still run, and one whose point happens to lie on the locked axis is taken in
 * preference to the bare projection of the cursor: dragging vertically onto an endpoint
 * that shares the reference point's X gives that endpoint exactly, marker and all, and
 * the segment is still perfectly vertical. Only when nothing lands on the axis does the
 * cursor's own projection stand, which is the plain ortho point.
 *
 * Registered ahead of those snaps because it has to be the one that decides - it runs
 * them itself (see `candidates`) rather than being overridden by whichever of them
 * would have matched first.
 */
export class OrthoSnap implements ISnap {
    private _tempLine?: [IView, number];

    constructor(
        readonly refPoint: () => XYZ | undefined,
        readonly plane?: (point: XYZ) => Plane,
        /**
         * The snaps ortho consults for a point already on its axis - object snap and the
         * tracking snaps, in the order the handler would have tried them. Left out, ortho
         * is the bare axis lock it always was.
         */
        private readonly candidates: readonly ISnap[] = [],
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
        const axisName = I18n.translate(useX ? "axis.x" : "axis.y");

        // The alignment path is drawn for the axis itself, so it is there whichever of
        // the two answers below is taken - it is describing the lock, not the point.
        this.showTempLine(data.view, refPoint, direction, distance);

        const onAxis = this.snapOnAxis(data, refPoint, direction);
        if (onAxis) {
            return {
                ...onAxis,
                refPoint,
                // Reported from the reference point so the tip and the dimension boxes
                // read the segment's own length, not whatever the inner snap measured
                // from - it had no idea this pick had a reference point.
                distance: onAxis.point!.distanceTo(refPoint),
                info: [axisName, onAxis.info].filter(Boolean).join(" "),
            };
        }

        return {
            view: data.view,
            point: refPoint.add(direction.multiply(distance)),
            refPoint,
            distance: Math.abs(distance),
            info: axisName,
            shapes: [],
            type: "axis",
        };
    }

    /**
     * The first candidate snap whose point lies on the locked axis, if any.
     *
     * Every candidate is asked, not just the first to answer, because the one that
     * answers first is the one nearest the cursor and the cursor is off the axis by
     * definition - it is what ortho is correcting. Asking all of them and keeping the
     * first that is actually on the axis is what lets a vertical drag past a midpoint
     * still find the endpoint above it.
     *
     * Each candidate that does not win has its own dynamic objects taken back down, so
     * a rejected snap cannot leave its marker on screen (the bug ortho itself had).
     */
    private snapOnAxis(data: MouseAndDetected, refPoint: XYZ, direction: XYZ): SnapResult | undefined {
        if (this.candidates.length === 0) return undefined;

        const tolerance = ON_AXIS_TOLERANCE_PIXELS * worldUnitsPerPixel(data.view);
        let winner: SnapResult | undefined;

        for (const candidate of this.candidates) {
            const result = candidate.snap(data);
            if (!winner && result?.point && this.isOnAxis(result.point, refPoint, direction, tolerance)) {
                winner = result;
            } else {
                candidate.removeDynamicObject();
            }
        }

        return winner;
    }

    /** Whether `point` sits on the ray through `refPoint`, within `tolerance`. */
    private isOnAxis(point: XYZ, refPoint: XYZ, direction: XYZ, tolerance: number): boolean {
        const vector = point.sub(refPoint);
        // The component across the axis is what "off the axis" means; the component
        // along it is the distance the user is choosing and is free to be anything.
        const across = vector.sub(direction.multiply(vector.dot(direction)));
        return across.length() <= tolerance;
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
        // The axis can change between one call and the next - a cursor crossing the
        // diagonal swaps X for Y - and a snap that is drawn but then rejected by the
        // pick's validator never reaches a removeDynamicObject of its own. Dropping the
        // previous line here rather than overwriting the field keeps the stale axis from
        // being left on screen beside the live one.
        this.removeDynamicObject();

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
