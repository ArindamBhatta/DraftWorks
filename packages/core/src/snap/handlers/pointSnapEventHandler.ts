import { Config } from "../../config";
import type { IDocument } from "../../document";
import { type AsyncController, UnitSetup } from "../../foundation";
import type { I18nKeys } from "../../i18n";
import { type Line, type Plane, XYZ } from "../../math";
import type { ICurve, ShapeType } from "../../shape";
import type { IView } from "../../visual";
import { type Dimension, DimensionUtils } from "../dimension";
import type { ISnap, SnapData, SnapResult } from "../snap";
import {
    AxisSnap,
    ObjectSnap,
    OrthoSnap,
    PlaneSnap,
    PointOnCurveSnap,
    SurfaceSnap,
    WorkplaneSnap,
} from "../snaps";
import { TrackingSnap } from "../tracking";
import { SnapEventHandler } from "./snapEventHandler";

export interface PointSnapData extends SnapData {
    dimension?: Dimension;
    refPoint?: () => XYZ;
    plane?: () => Plane;
}

export interface SnapPointOnCurveData extends PointSnapData {
    curve: ICurve;
}

export interface SnapPointOnAxisData extends PointSnapData {
    ray: Line;
}

export class PointSnapEventHandler extends SnapEventHandler<PointSnapData> {
    constructor(document: IDocument, controller: AsyncController, pointData: PointSnapData) {
        super(document, controller, [], pointData);
        this.snaps.push(...this.getInitSnaps(pointData));
    }

    /**
     * Dynamic input only means anything once there is a point to measure from, so
     * like ortho it sits out the first pick of a command. Read fresh each time so
     * toggling DYN in the status bar takes effect mid-command.
     */
    protected override dynamicInputPlane(): Plane | undefined {
        if (!Config.instance.enableDynamicInput || this.getRefPoint() === undefined) return undefined;
        return this.data.plane?.() ?? this.document.application.activeView?.workplane;
    }

    protected override dynamicInputRefPoint(): XYZ | undefined {
        return this.getRefPoint();
    }

    protected getInitSnaps(pointData: PointSnapData): ISnap[] {
        const objectSnap = new ObjectSnap(Config.instance.snapType, pointData.refPoint);
        const workplaneSnap = pointData.plane
            ? new PlaneSnap(pointData.plane, pointData.refPoint)
            : new WorkplaneSnap(pointData.refPoint);
        const trackingSnap = new TrackingSnap(pointData.refPoint, true);
        const surfaceSnap = new SurfaceSnap();
        return [...this.getOrthoSnaps(pointData), objectSnap, trackingSnap, surfaceSnap, workplaneSnap];
    }

    /**
     * Ortho only means something once there is a point to measure from, so it is skipped
     * for the first pick of a command. It reads Config.instance.enableOrtho on every
     * snap, so toggling the status bar button mid-command takes effect immediately.
     */
    protected getOrthoSnaps(pointData: PointSnapData): ISnap[] {
        return pointData.refPoint ? [new OrthoSnap(pointData.refPoint, pointData.plane)] : [];
    }

    protected getPointFromInput(view: IView, text: string): SnapResult {
        const [dims, isAbsolute] = this.parseInputDimensions(text);
        const refPoint = this.getRefPoint() ?? XYZ.zero;
        const result: SnapResult = { point: refPoint, view, shapes: [], type: "input" };

        if (isAbsolute) {
            result.point = new XYZ({ x: dims[0], y: dims[1], z: dims[2] });
        } else if (dims.length === 1 && this._snaped?.point) {
            result.point = this.calculatePointFromDistance(refPoint, dims[0]);
        } else if (dims.length > 1) {
            result.point = this.calculatePointFromCoordinates(refPoint, dims);
        }

        return result;
    }

    private parseInputDimensions(text: string): [number[], boolean] {
        const isAbsolute = text.startsWith("#");
        if (isAbsolute) {
            text = text.slice(1);
        }
        // Every field is a length, so AutoCAD unit syntax works per coordinate:
        // `11'2",3'` is as valid as `134,36`. NaN marks a field inputError rejects.
        const dims = text.split(",").map((part) => UnitSetup.tryParseLength(part) ?? Number.NaN);
        return [dims, isAbsolute];
    }

    private calculatePointFromDistance(refPoint: XYZ, distance: number): XYZ {
        const vector = this._snaped!.point!.sub(refPoint).normalize()!;
        return refPoint.add(vector.multiply(distance));
    }

    private calculatePointFromCoordinates(refPoint: XYZ, dims: number[]): XYZ {
        const plane = this.data.plane?.() ?? this.snaped!.view.workplane;
        let point = refPoint.add(plane.xvec.multiply(dims[0])).add(plane.yvec.multiply(dims[1]));
        if (dims.length === 3) {
            point = point.add(plane.normal.multiply(dims[2]));
        }
        return point;
    }

    protected inputError(text: string): I18nKeys | undefined {
        const [dims, isAbsolute] = this.parseInputDimensions(text);
        const dimension = DimensionUtils.from(dims.length);

        if (isAbsolute && dims.length !== 3) return "error.input.threeNumberCanBeInput";
        if (!this.isValidDimension(dimension)) return "error.input.unsupportedInputs";
        if (this.hasInvalidNumbers(dims)) return "error.input.invalidNumber";
        if (this.requiresThreeNumbers(dims)) return "error.input.threeNumberCanBeInput";
        if (this.isInvalidSingleNumber(dims)) return "error.input.cannotInputANumber";

        return undefined;
    }

    private isValidDimension(dimension: Dimension): boolean {
        return DimensionUtils.contains(this.data.dimension!, dimension);
    }

    private hasInvalidNumbers(dims: number[]): boolean {
        return dims.some(Number.isNaN);
    }

    private requiresThreeNumbers(dims: number[]): boolean {
        const refPoint = this.getRefPoint();
        return refPoint === undefined && dims.length !== 3;
    }

    private isInvalidSingleNumber(dims: number[]): boolean {
        const refPoint = this.getRefPoint();
        return dims.length === 1 && refPoint! && (!this._snaped || this._snaped.point!.isEqualTo(refPoint));
    }

    private getRefPoint(): XYZ | undefined {
        return this.data.refPoint?.() ?? this._snaped?.refPoint;
    }
}

export class SnapPointOnCurveEventHandler extends SnapEventHandler<SnapPointOnCurveData> {
    constructor(document: IDocument, controller: AsyncController, pointData: SnapPointOnCurveData) {
        const objectSnap = new ObjectSnap(Config.instance.snapType);
        const snap = new PointOnCurveSnap(pointData);
        const surfaceSnape = new SurfaceSnap();
        const workplaneSnap = new WorkplaneSnap();
        super(document, controller, [objectSnap, snap, surfaceSnape, workplaneSnap], pointData);
    }

    protected override getPointFromInput(view: IView, text: string): SnapResult {
        const length = this.data.curve.length();
        const parameter = UnitSetup.parseLength(text) / length;
        return { point: this.data.curve.value(parameter), view, shapes: [], type: "input" };
    }

    protected override inputError(text: string) {
        return UnitSetup.isValidLength(text) ? undefined : "error.input.invalidNumber";
    }
}

export class SnapPointOnAxisEventHandler extends SnapEventHandler<SnapPointOnAxisData> {
    constructor(document: IDocument, controller: AsyncController, pointData: SnapPointOnAxisData) {
        const objectSnap = new ObjectSnap(Config.instance.snapType);
        const snap = new AxisSnap(pointData.ray.point, pointData.ray.direction);
        super(document, controller, [objectSnap, snap], pointData);
    }

    protected override getPointFromInput(view: IView, text: string): SnapResult {
        const parameter = UnitSetup.parseLength(text);
        const point = this.data.ray.point.add(this.data.ray.direction.multiply(parameter));
        return { point, view, shapes: [], type: "input" };
    }

    protected override inputError(text: string) {
        return UnitSetup.isValidLength(text) ? undefined : "error.input.invalidNumber";
    }
}

export class SnapPointPlaneEventHandler extends PointSnapEventHandler {
    protected override getInitSnaps(pointData: PointSnapData): ISnap[] {
        if (!pointData.plane) throw new Error("plane is required");

        return [
            ...this.getOrthoSnaps(pointData),
            new ObjectSnap(Config.instance.snapType),
            new PlaneSnap(pointData.plane),
        ];
    }

    protected override findSnapPoint(shapeType: ShapeType, view: IView, event: PointerEvent): void {
        super.findSnapPoint(shapeType, view, event);

        if (this._snaped?.point) {
            this._snaped.point = this.data.plane!().project(this._snaped.point);
        }
    }
}
