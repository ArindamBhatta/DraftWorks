import { Config, VisualConfig } from "../../config";
import type { IDocument } from "../../document";
import { Precision } from "../../foundation";
import { I18n } from "../../i18n";
import { type Line, MathUtils, XY, type XYZ } from "../../math";
import { type ISubEdgeShape, MeshDataUtils, ShapeTypes } from "../../shape";
import { type IView, screenDistance } from "../../visual";
import type { ISnap, MouseAndDetected, SnapResult, SnapType } from "../";
import type { Axis } from "./axis";
import { AxisTracking } from "./axisTracking";
import { ObjectTracking } from "./objectTracking";

export interface TrackingData {
    axis: Axis;
    point: XYZ;
    isObjectTracking: boolean;
    distance: number;
    info: string;
    snapType: SnapType;
}

export class TrackingSnap implements ISnap {
    private readonly _axisTracking: AxisTracking;
    private readonly _objectTracking: ObjectTracking;
    private readonly _tempLines: Map<IView, number[]> = new Map();

    constructor(
        readonly referencePoint: (() => XYZ) | undefined,
        trackingAxisZ: boolean,
    ) {
        this._axisTracking = new AxisTracking(trackingAxisZ);
        this._objectTracking = new ObjectTracking(trackingAxisZ);
        Config.instance.onPropertyChanged(this.onSnapTypeChanged);
    }

    readonly handleSnaped = (document: IDocument, snaped?: SnapResult) => {
        if (Config.instance.enableSnapTracking) {
            this._objectTracking.showTrackingAtTimeout(document, snaped);
        }
    };

    snap(data: MouseAndDetected): SnapResult | undefined {
        // Two independent modes feed this snap - polar tracking (F10) and object snap
        // tracking (F11) - so it is dead only when both are off. detectTracking gates
        // each source separately; this is just the early out.
        if (!Config.instance.enablePolarTracking && !Config.instance.enableSnapTracking) return undefined;

        const trackingDatas = this.detectTracking(data.view, data.mx, data.my);
        if (trackingDatas.length === 0) return undefined;
        // Nearest path first: the rest of this method takes [0] as the one the cursor is
        // on, and it names the tooltip and the distance reported from it. `sort` wants a
        // comparator, and was being given a key - which returns a positive number for
        // every pair and so leaves the order to the sort's own internals, handing the
        // wrong path's measurement to a user standing on a different one.
        trackingDatas.sort((a, b) => a.distance - b.distance);
        const snaped = this.shapeIntersectTracking(data, trackingDatas);
        if (snaped !== undefined) return snaped;
        if (trackingDatas.length === 1) {
            return this.getSnapedAndShowTracking(data.view, trackingDatas[0].point, [trackingDatas[0]]);
        }
        return (
            this.trackingIntersectTracking(data.view, trackingDatas) ??
            this.getSnapedAndShowTracking(data.view, trackingDatas[0].point, [trackingDatas[0]])
        );
    }

    private trackingIntersectTracking(view: IView, trackingDatas: TrackingData[]) {
        const point = trackingDatas[0].axis.intersect(trackingDatas[1].axis);
        return point
            ? this.getSnapedAndShowTracking(view, point, [trackingDatas[0], trackingDatas[1]])
            : undefined;
    }

    private getSnapedAndShowTracking(
        view: IView,
        point: XYZ,
        trackingDatas: TrackingData[],
    ): SnapResult | undefined {
        if (trackingDatas.length === 0) return undefined;

        const lines: number[] = trackingDatas
            .map((x) => this.showTempLine(view, x.axis.point, point))
            .filter((id) => id !== undefined);
        this.addTempLine(view, lines);

        let info: string | undefined;
        const distance = point.distanceTo(trackingDatas[0].axis.point);
        if (MathUtils.almostEqual(distance, 0)) return undefined;

        if (trackingDatas.length === 1) {
            info = trackingDatas[0].axis.name;
        } else if (trackingDatas.length === 2) {
            if (MathUtils.almostEqual(point.distanceTo(trackingDatas[1].axis.point), 0)) {
                return undefined;
            }

            info = I18n.translate("snap.intersection");
        }
        const refPoint = trackingDatas[0].axis.point;
        return { view, point, info, shapes: [], refPoint, distance, type: "trace" };
    }

    private showTempLine(view: IView, start: XYZ, end: XYZ): number | undefined {
        const vector = end.sub(start);
        const normal = vector.normalize();
        if (!normal) return undefined;
        const distance = Math.min(vector.length() * 1e10, 1e20);
        const newEnd = start.add(normal.multiply(distance));
        const lineDats = MeshDataUtils.createEdgeMesh(start, newEnd, VisualConfig.temporaryEdgeColor, "dash");
        return view.document.visual.context.displayMesh([lineDats]);
    }

    private shapeIntersectTracking(
        data: MouseAndDetected,
        trackingDatas: TrackingData[],
    ): SnapResult | undefined {
        if (data.shapes.length === 0 || data.shapes[0].shape.shapeType !== ShapeTypes.edge) return undefined;
        const point = this.findIntersection(data, trackingDatas);
        if (!point) return undefined;
        const id = this.showTempLine(data.view, point.location, point.intersect);
        if (id === undefined) return undefined;
        this.addTempLine(data.view, [id]);

        return {
            view: data.view,
            point: point.intersect,
            info: I18n.translate("snap.intersection"),
            shapes: [data.shapes[0]],
            type: "traceIntersect",
        };
    }

    private addTempLine(view: IView, ids: number[]) {
        const existingIds = this._tempLines.get(view) ?? [];
        this._tempLines.set(view, existingIds.concat(ids));
    }

    private findIntersection(data: MouseAndDetected, trackingDatas: TrackingData[]) {
        const edge = data.shapes[0].shape as ISubEdgeShape;
        const points: { intersect: XYZ; location: XYZ }[] = [];
        trackingDatas.forEach((x) => {
            edge.intersect(x.axis).forEach((p) => {
                points.push({ intersect: p.point, location: x.axis.point });
            });
        });
        // Nearest to the cursor, comparator not key - see the sort in snap().
        points.sort(
            (a, b) =>
                screenDistance(data.view, data.mx, data.my, a.intersect) -
                screenDistance(data.view, data.mx, data.my, b.intersect),
        );
        return points.at(0);
    }

    private detectTracking(view: IView, x: number, y: number) {
        const data: TrackingData[] = [];
        // Polar tracking: rays from the point the command is measuring from, at every
        // multiple of POLARANG. The four workplane axes this used to offer are just the
        // 90° case, so nothing is lost when polarAngles is left at its default.
        if (this.referencePoint && Config.instance.enablePolarTracking) {
            const axies = this._axisTracking.getAxes(
                view,
                this.referencePoint(),
                Config.instance.polarAngles,
            );
            data.push(...this.getSnapedFromAxes(axies, view, x, y, "axis"));
        }
        // Object snap tracking: rays from points acquired by hovering an object snap.
        if (Config.instance.enableSnapTracking) {
            const objectTrackingRays = this._objectTracking.getTrackingRays(view);
            objectTrackingRays.forEach((a) => {
                data.push(...this.getSnapedFromAxes(a.axes, view, x, y, a.snapType, a.objectName));
            });
        }
        return data;
    }

    private getSnapedFromAxes(
        axes: Axis[],
        view: IView,
        x: number,
        y: number,
        snapType: SnapType,
        snapedName?: string,
    ) {
        const result: TrackingData[] = [];
        for (const axis of axes) {
            const distance = this.rayDistanceAtScreen(view, x, y, axis);
            if (distance < Config.instance.SnapDistance) {
                const ray = view.rayAt(x, y);
                const point = axis.nearestTo(ray.toLine());
                if (point.sub(axis.point).dot(axis.direction) < 0) continue;
                result.push({
                    axis,
                    distance,
                    point,
                    info: snapedName ?? axis.name,
                    isObjectTracking: snapedName !== undefined,
                    snapType,
                });
            }
        }
        return result;
    }

    private rayDistanceAtScreen(view: IView, x: number, y: number, axis: Line): number {
        const start = view.worldToScreen(axis.point);
        const vector = new XY({ x: x - start.x, y: y - start.y });
        if (vector.isEqualTo(XY.zero)) return 0;
        const end = view.worldToScreen(axis.point.add(axis.direction.multiply(100000)));
        if (start.distanceTo(end) < Precision.Float) return vector.length();
        const dir = end.sub(start).normalize()!;
        const dot = vector.dot(dir);
        // Clamped at zero before the square root. This is Pythagoras on a vector that is
        // exactly along `dir` when the cursor is sitting on the path, where rounding can
        // leave lengthSq - dot² a hair below zero - and `Math.sqrt` of that is NaN, which
        // fails `distance < SnapDistance` and drops the tracking at the one moment the
        // user is precisely on it.
        return Math.sqrt(Math.max(0, vector.lengthSq() - dot * dot));
    }

    removeDynamicObject(): void {
        this._tempLines.forEach((v, k) => {
            v.forEach((id) => {
                k.document.visual.context.removeMesh(id);
            });
        });
        this._tempLines.clear();
    }

    private readonly onSnapTypeChanged = (property: keyof Config): void => {
        // The axis cache is built once per view from the polar angle in force at the
        // time, and cannot tell that the angle has since moved - so a change to either
        // polar setting has to throw it away, not just stop it being consulted.
        if (
            property === "snapType" ||
            property === "enableSnapTracking" ||
            property === "enableSnap" ||
            property === "enablePolarTracking" ||
            property === "polarAngles"
        ) {
            this.removeDynamicObject();
            this._objectTracking.clear();
            this._axisTracking.clear();
        }
    };

    clear(): void {
        this.removeDynamicObject();
        this._axisTracking.clear();
        this._objectTracking.clear();
        Config.instance.removePropertyChanged(this.onSnapTypeChanged);
    }
}
