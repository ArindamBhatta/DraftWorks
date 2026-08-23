import { Config, VisualConfig } from "../../config";
import type { IDocument } from "../../document";
import { I18n, type I18nKeys } from "../../i18n";
import { Line, type Ray, type XYZ } from "../../math";
import { CurveUtils, type ICircle, type IEdge, type IVertex, MeshDataUtils, ShapeTypes } from "../../shape";
import { type ObjectSnapType, ObjectSnapTypes, ObjectSnapTypeUtils } from "../../snapType";
import { type IView, type IVisualContext, screenDistance, type VisualShapeData } from "../../visual";
import type { MouseAndDetected, SnapResult, SnapType } from "../snap";
import { snapMarkerMesh } from "../snapMarker";
import { BaseSnap } from "./baseSnap";

interface InvisibleSnapInfo {
    view: IView;
    snaps: SnapResult[];
    displays: number[];
}

/**
 * Snap kinds that name a specific spot on an object, as opposed to "somewhere along
 * it". These get the wider capture radius below and are drawn as markers, because they
 * are the ones you are aiming at when you want an exact value.
 */
const KEY_POINT_TYPES: ReadonlySet<SnapType> = new Set<SnapType>([
    "end",
    "middle",
    "center",
    "intersection",
    "vertex",
]);

/**
 * How much further than the plain aperture a key point pulls the cursor in.
 *
 * Without this, "nearest point on curve" wins as soon as you are more than the aperture
 * from the endpoint - so the cursor slides smoothly along a line and never locks to its
 * end, which is the opposite of the magnet AutoCAD gives you. Endpoints have to out-rank
 * a snap that can match anywhere.
 */
const KEY_POINT_MAGNET = 2.5;

/** How close the cursor has to get before this kind of snap takes hold. */
export function snapReach(type: SnapType, aperture: number): number {
    return KEY_POINT_TYPES.has(type) ? aperture * KEY_POINT_MAGNET : aperture;
}

/**
 * Picks which snap wins: the nearest candidate that is inside its *own* reach.
 *
 * Both halves matter. Taking the nearest overall and testing one radius let "nearest
 * point on curve" win as soon as the cursor was more than an aperture from the endpoint,
 * so the cursor slid along a line and never locked to its end. Giving key points a
 * bigger radius without keeping the distance order would let a far endpoint beat a
 * midpoint right under the cursor.
 *
 * `orderedByDistance` must already be sorted nearest-first.
 */
export function selectSnapWithinReach<T extends { type: SnapType }>(
    orderedByDistance: readonly T[],
    distanceOf: (candidate: T) => number,
    aperture: number,
): T | undefined {
    return orderedByDistance.find((candidate) => distanceOf(candidate) < snapReach(candidate.type, aperture));
}

export class ObjectSnap extends BaseSnap {
    private readonly _intersectionInfos: Map<string, SnapResult[]> = new Map();
    private readonly _invisibleInfos: Map<VisualShapeData, InvisibleSnapInfo> = new Map();
    private _lastDetected?: [IView, SnapResult];
    private _hintVertex?: [IVisualContext, number];
    private _keyPointMarkers?: { context: IVisualContext; ids: number[] };

    constructor(
        private _snapType: ObjectSnapType,
        referencePoint?: () => XYZ,
    ) {
        super(referencePoint);
        Config.instance.onPropertyChanged(this.onSnapTypeChanged);
    }

    override clear() {
        super.clear();
        this._invisibleInfos.forEach((info) => {
            info.displays.forEach((x) => info.view.document.visual.context.removeMesh(x));
        });
        this.removeHint();
        this.removeKeyPointMarkers();
        Config.instance.removePropertyChanged(this.onSnapTypeChanged);
    }

    readonly handleSnaped = (document: IDocument, snaped?: SnapResult | undefined) => {
        if (snaped?.shapes.length === 0 && this._lastDetected) {
            this.displayHint(this._lastDetected[0], this._lastDetected[1]);
            this._lastDetected = undefined;
        }
    };

    private readonly onSnapTypeChanged = (property: keyof Config) => {
        if (property === "snapType" || property === "enableSnap") {
            this._snapType = Config.instance.snapType;
            this._intersectionInfos.clear();
        }
    };

    override removeDynamicObject(): void {
        super.removeDynamicObject();
        this.removeHint();
        this.removeKeyPointMarkers();
    }

    private removeHint() {
        if (this._hintVertex !== undefined) {
            this._hintVertex[0].removeMesh(this._hintVertex[1]);
            this._hintVertex = undefined;
        }
    }

    snap(data: MouseAndDetected): SnapResult | undefined {
        if (!Config.instance.enableSnap) return undefined;

        let snap: SnapResult | undefined;
        if (data.shapes.some((x) => x.shape.shapeType === ShapeTypes.edge)) {
            this.showInvisibleSnaps(data.view, data.shapes[0]);
            snap = this.snapOnShape(data.view, data.mx, data.my, data.shapes);
        } else {
            snap = this.snapeInvisible(data.view, data.mx, data.my);
        }
        if (this.referencePoint && snap?.point) {
            snap.distance = this.referencePoint().distanceTo(snap.point);
        }
        return snap;
    }

    private snapOnShape(view: IView, x: number, y: number, shapes: VisualShapeData[]) {
        const featurePoints = this.getFeaturePoints(view, shapes[0]);
        const perpendiculars = this.findPerpendicular(view, shapes[0]);
        const intersections = this.getIntersections(view, shapes[0], shapes);
        const candidates = [...featurePoints, ...perpendiculars, ...intersections];

        // Show where the magnets are while the cursor is over the object, so an endpoint
        // is visible before you reach it rather than only once it has been grabbed.
        this.showKeyPointMarkers(view, candidates);

        const ordered = candidates.sort((a, b) => this.sortSnaps(view, x, y, a, b));
        if (ordered.length === 0) {
            return undefined;
        }

        // Nearest candidate that is inside its own reach - so a midpoint 5px away still
        // beats an endpoint 20px away, but an endpoint 20px away beats nothing at all.
        const aperture = Config.instance.SnapDistance;
        const grabbed = selectSnapWithinReach(
            ordered,
            (candidate) => screenDistance(view, x, y, candidate.point!),
            aperture,
        );
        if (grabbed) {
            this.highlight(grabbed.shapes);
            return grabbed;
        }

        const nearest = this.findNearestPointAtEdgeCurve(view, shapes[0], view.rayAt(x, y));
        if (nearest && screenDistance(view, x, y, nearest.point!) < aperture) {
            this.highlight(nearest.shapes);
            return nearest;
        }

        this._lastDetected = [view, ordered[0]];
        return undefined;
    }

    /**
     * Draws AutoCAD's object-snap markers at every key point of the object under the
     * cursor, so you can see where the magnets are before you reach one - a square on
     * each endpoint, a triangle at the midpoint, a circle at a centre.
     *
     * Rebuilt on every pointer move rather than cached - SnapEventHandler clears all
     * dynamic snap visuals at the top of each move, so these share the lifecycle of the
     * temporary point and the tracking lines.
     */
    private showKeyPointMarkers(view: IView, candidates: SnapResult[]) {
        const points = candidates.filter((x) => x.point && KEY_POINT_TYPES.has(x.type));
        if (points.length === 0) return;

        const ids = points.map((snap) =>
            view.document.visual.context.displayMesh([
                snapMarkerMesh(view, snap.type, snap.point!, VisualConfig.snapMarkerColor) ??
                    MeshDataUtils.createVertexMesh(
                        snap.point!,
                        VisualConfig.snapMarkerSize,
                        VisualConfig.snapMarkerColor,
                    ),
            ]),
        );
        this._keyPointMarkers = { context: view.document.visual.context, ids };
    }

    private removeKeyPointMarkers() {
        if (!this._keyPointMarkers) return;
        this._keyPointMarkers.ids.forEach((id) => this._keyPointMarkers!.context.removeMesh(id));
        this._keyPointMarkers = undefined;
    }

    private getFeaturePoints(view: IView, shape: VisualShapeData): SnapResult[] {
        const points: SnapResult[] = [];
        if (shape.shape.shapeType === ShapeTypes.vertex) {
            this.collectVertexFeaturePoints(view, shape, points);
        } else if (shape.shape.shapeType === ShapeTypes.edge) {
            this.collectEdgeFeaturePoints(view, shape, points);
        }
        return points;
    }

    private collectVertexFeaturePoints(view: IView, shape: VisualShapeData, infos: SnapResult[]) {
        if (ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.vertex)) {
            const point = shape.transform.ofPoint((shape.shape as IVertex).point());
            infos.push({
                view,
                point,
                info: I18n.translate("vertex.point"),
                shapes: [shape],
                type: "vertex",
            });
        }
    }

    private collectEdgeFeaturePoints(view: IView, shape: VisualShapeData, infos: SnapResult[]) {
        const curve = (shape.shape as IEdge).curve;
        const start = curve.startPoint();
        const end = curve.endPoint();

        const addPoint = (point: XYZ, info: I18nKeys, type: SnapType) =>
            infos.push({
                view,
                point: shape.transform.ofPoint(point),
                type,
                info: I18n.translate(info),
                shapes: [shape],
            });

        if (ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.endPoint)) {
            addPoint(start, "snap.end", "end");
            addPoint(end, "snap.end", "end");
        }
        if (ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.midPoint)) {
            const mid = curve.value((curve.firstParameter() + curve.lastParameter()) * 0.5);
            addPoint(mid, "snap.mid", "middle");
        }
        if (this.referencePoint && ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.tangent)) {
            if (CurveUtils.isCircle(curve.basisCurve)) {
                const refInLocal = shape.transform.invert()!.ofPoint(this.referencePoint());
                CurveUtils.tangentPoints(curve.basisCurve, refInLocal).forEach((tangent) => {
                    addPoint(tangent, "snap.tangent", "tangent");
                });
            }
        }
    }

    private displayHint(view: IView, shape: SnapResult) {
        this.highlight(shape.shapes);
        const data = MeshDataUtils.createVertexMesh(
            shape.point!,
            VisualConfig.hintVertexSize,
            VisualConfig.hintVertexColor,
        );
        this._hintVertex = [view.document.visual.context, view.document.visual.context.displayMesh([data])];
    }

    private snapeInvisible(view: IView, x: number, y: number): SnapResult | undefined {
        const { minDistance, snap } = this.getNearestInvisibleSnap(view, x, y);
        if (minDistance < Config.instance.SnapDistance) {
            this.highlight(snap!.shapes);
            return snap;
        }
        return undefined;
    }

    private getNearestInvisibleSnap(
        view: IView,
        x: number,
        y: number,
    ): { minDistance: number; snap?: SnapResult } {
        let snap: SnapResult | undefined;
        let minDistance = Number.MAX_VALUE;

        this._invisibleInfos.forEach((info) => {
            info.snaps.forEach((s) => {
                const dist = screenDistance(view, x, y, s.point!);
                if (dist < minDistance) {
                    minDistance = dist;
                    snap = s;
                }
            });
        });
        return { minDistance, snap };
    }

    private showInvisibleSnaps(view: IView, shape: VisualShapeData) {
        if (shape.shape.shapeType === ShapeTypes.edge) {
            if (this._invisibleInfos.has(shape)) return;
            const curve = (shape.shape as IEdge).curve;
            const basisCurve = curve.basisCurve;
            if (CurveUtils.isCircle(basisCurve)) {
                this.showCircleCenter(basisCurve, view, shape);
            }
        }
    }

    private showCircleCenter(curve: ICircle, view: IView, shape: VisualShapeData) {
        const center = shape.transform.ofPoint(curve.center);
        const temporary = MeshDataUtils.createVertexMesh(
            center,
            VisualConfig.hintVertexSize,
            VisualConfig.hintVertexColor,
        );
        const id = view.document.visual.context.displayMesh([temporary]);
        this._invisibleInfos.set(shape, {
            view,
            snaps: [
                {
                    view,
                    point: center,
                    info: I18n.translate("snap.center"),
                    shapes: [shape],
                    type: "center",
                },
            ],
            displays: [id],
        });
    }

    private sortSnaps(view: IView, x: number, y: number, a: SnapResult, b: SnapResult): number {
        return screenDistance(view, x, y, a.point!) - screenDistance(view, x, y, b.point!);
    }

    private findPerpendicular(view: IView, shape: VisualShapeData): SnapResult[] {
        const result: SnapResult[] = [];
        if (
            !ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.perpendicular) ||
            this.referencePoint === undefined
        ) {
            return result;
        }

        if (shape.shape.shapeType === ShapeTypes.edge) {
            const curve = (shape.shape as IEdge).curve;
            const transform = shape.transform;
            const point = curve.project(transform.invert()!.ofPoint(this.referencePoint())).at(0);
            if (point === undefined) return result;
            result.push({
                view,
                point: transform.ofPoint(point),
                info: I18n.translate("snap.perpendicular"),
                shapes: [shape],
                type: "perpendicular",
            });
        }

        return result;
    }

    private getIntersections(view: IView, current: VisualShapeData, shapes: VisualShapeData[]) {
        const result: SnapResult[] = [];
        if (
            !ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.intersection) ||
            current.shape.shapeType !== ShapeTypes.edge
        ) {
            return result;
        }
        shapes.forEach((x) => {
            if (x === current || x.shape.shapeType !== ShapeTypes.edge) return;
            const key = this.getIntersectionKey(current, x);
            let arr = this._intersectionInfos.get(key);
            if (arr === undefined) {
                arr = this.findIntersections(view, current, x);
                this._intersectionInfos.set(key, arr);
            }
            result.push(...arr);
        });
        return result;
    }

    private getIntersectionKey(s1: VisualShapeData, s2: VisualShapeData) {
        return s1.shape.id < s2.shape.id ? `${s1.shape.id}:${s2.shape.id}` : `${s2.shape.id}:${s1.shape.id}`;
    }

    private findIntersections(view: IView, s1: VisualShapeData, s2: VisualShapeData): SnapResult[] {
        const e1 = s1.shape.transformedMul(s1.transform) as IEdge;
        const e2 = s2.shape.transformedMul(s2.transform) as IEdge;
        const intersections = e1.intersect(e2);
        e1.dispose();
        e2.dispose();
        return intersections.map((point) => {
            return {
                view,
                point: point.point,
                info: I18n.translate("snap.intersection"),
                shapes: [s1, s2],
                type: "intersection",
            };
        });
    }

    private findNearestPointAtEdgeCurve(
        view: IView,
        shape: VisualShapeData,
        ray: Ray,
    ): SnapResult | undefined {
        if (!ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.onCurve)) {
            return undefined;
        }
        if (shape.shape.shapeType === ShapeTypes.edge) {
            const curve = (shape.shape as IEdge).curve;
            const transform = shape.transform;
            const point = curve.nearestExtrema(
                new Line({
                    point: transform.invert()!.ofPoint(ray.point),
                    direction: transform.invert()!.ofVector(ray.direction),
                }),
            )?.p1;

            if (point === undefined) return undefined;
            return {
                view,
                point: transform.ofPoint(point),
                info: I18n.translate("snap.nearCurve"),
                shapes: [shape],
                type: "nearCurve",
            };
        }

        return undefined;
    }
}
