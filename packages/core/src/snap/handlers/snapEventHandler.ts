import { Config, VisualConfig } from "../../config";
import type { IDocument } from "../../document";
import { type AsyncController, type MessageType, PubSub, Result, UnitSetup } from "../../foundation";
import type { I18nKeys } from "../../i18n";
import type { Plane, XYZ } from "../../math";
import { MeshDataUtils, type ShapeMeshData, type ShapeType, ShapeTypes } from "../../shape";
import { type IEventHandler, type IView, type MeshOption, screenDistance } from "../../visual";
import { applyDynamicLocks, type DynamicInputLocks, hasAnyLock, polarOf } from "../dynamicInput";
import {
    hasStepOptions,
    type ISnap,
    type MouseAndDetected,
    matchStepOption,
    type SnapData,
    type SnapResult,
} from "../snap";
import { snapMarkerMesh } from "../snapMarker";

type SnapState = "idle" | "snapping" | "inputing" | "cancelled" | "completed";

export abstract class SnapEventHandler<D extends SnapData = SnapData> implements IEventHandler {
    private _tempPoint?: number;
    private _tempShapes?: number[];
    protected showTempPoint: boolean = true;
    protected _snaped?: SnapResult;
    private _state: SnapState = "idle";
    /** What the user has pinned in the cursor's distance/angle boxes. */
    private _locks: DynamicInputLocks = {};
    private _dynamicShown = false;

    facePreviewOpion: MeshOption = { meshOpacity: 1 };
    isEnabled: boolean = true;

    constructor(
        readonly document: IDocument,
        readonly controller: AsyncController,
        readonly snaps: ISnap[],
        readonly data: D,
    ) {
        this.showTempShape(undefined);
        controller.onCancelled(() => this.handleCancel());
        controller.onCompleted(() => this.handleSuccess());
    }

    get snaped() {
        return this._snaped;
    }
    get state() {
        return this._state;
    }

    dispose() {
        this._snaped = undefined;
        this._state = "completed";
    }

    private handleSuccess() {
        if (this._state === "completed") return;

        this._state = "completed";
        this.controller.success();
        this.cleanupResources();
    }

    private handleCancel() {
        if (this._state === "cancelled") return;

        this._state = "cancelled";
        this.controller.cancel();
        this.cleanupResources();
    }

    private cleanupResources() {
        this.clearSnapPrompt();
        this.clearInput();
        this.clearDynamicInput();
        this._locks = {};
        this.removeTempVisuals();
        this.snaps.forEach((snap) => snap.clear());
    }

    private clearInput() {
        PubSub.default.pub("clearInput");
    }

    pointerMove(view: IView, event: PointerEvent): void {
        this._state = "snapping";
        this.removeTempVisuals();
        this.updateSnapPoint(view, event);
        this.updateVisualFeedback(view);
    }

    private updateSnapPoint(view: IView, event: PointerEvent) {
        this.setSnaped(view, event);
        this.applyDynamicInput();
        if (this._snaped) {
            this.showSnapPrompt(this._snaped);
        } else {
            this.clearSnapPrompt();
        }
    }

    // ------------------------------------------------------------ dynamic input

    /**
     * The plane the cursor's distance/angle boxes are measured in, or undefined when
     * this kind of pick has no use for them. Handlers that measure from a reference
     * point (see PointSnapEventHandler) opt in by overriding this; everything else
     * inherits "no dynamic input" and behaves exactly as it did before.
     */
    protected dynamicInputPlane(): Plane | undefined {
        return undefined;
    }

    protected dynamicInputRefPoint(): XYZ | undefined {
        return undefined;
    }

    /**
     * Bends the snapped point to whatever the user has locked, then publishes what
     * the boxes should read. Runs after snapping so the readings describe the point
     * that will actually be committed - an endpoint snap shows its true distance,
     * not the raw cursor's.
     */
    private applyDynamicInput() {
        const plane = this.dynamicInputPlane();
        const refPoint = this.dynamicInputRefPoint();
        if (!plane || !refPoint) {
            // Genuinely not applicable here - the first point of a command, or DYN
            // switched off - so take the boxes down.
            this.clearDynamicInput();
            return;
        }
        // No snap for an instant (the cursor left the view, say). Leave the boxes
        // exactly as they are rather than tearing them down: the user may be typing
        // into one, and destroying the element would swallow what they had entered.
        if (!this._snaped?.point) return;

        if (hasAnyLock(this._locks)) {
            this._snaped.point = applyDynamicLocks(refPoint, this._snaped.point, this._locks, plane);
        }

        this._dynamicShown = true;
        PubSub.default.pub("showDynamicInput", {
            reading: polarOf(refPoint, this._snaped.point, plane),
            locks: this._locks,
            setLocks: this.setDynamicLocks,
            commit: this.commitDynamicInput,
        });
    }

    private clearDynamicInput() {
        if (!this._dynamicShown) return;
        this._dynamicShown = false;
        PubSub.default.pub("clearDynamicInput");
    }

    /**
     * Finishes the pick at whatever the boxes describe - Enter with a distance, an
     * angle, or both. Anything left unlocked keeps the value the cursor last had,
     * which is exactly what the boxes were showing at the time.
     */
    private readonly commitDynamicInput = (locks: DynamicInputLocks) => {
        const plane = this.dynamicInputPlane();
        const refPoint = this.dynamicInputRefPoint();
        const view = this._snaped?.view ?? this.document.application.activeView;
        if (!plane || !refPoint || !view) return;

        this._snaped = {
            view,
            point: applyDynamicLocks(refPoint, this._snaped?.point ?? refPoint, locks, plane),
            shapes: [],
            type: "input",
            refPoint,
        };
        this.handleSuccess();
    };

    /** Pins or releases one of the two boxes without committing the point. */
    private readonly setDynamicLocks = (locks: DynamicInputLocks) => {
        this._locks = locks;
    };

    private updateVisualFeedback(view: IView) {
        this.showTempShape(this._snaped?.point);
        view.document.visual.update();
    }

    protected setSnaped(view: IView, event: PointerEvent) {
        this.findSnapPoint((ShapeTypes.edge | ShapeTypes.vertex | ShapeTypes.face) as ShapeType, view, event);

        this.snaps.forEach((snap) => snap.handleSnaped?.(view.document.visual.document, this._snaped));
    }

    private findNearestFeaturePoint(view: IView, event: PointerEvent) {
        let minDist = Number.MAX_VALUE;
        let nearest;

        for (const point of this.data.featurePoints || []) {
            if (point.when && !point.when()) continue;

            const dist = screenDistance(view, event.offsetX, event.offsetY, point.point);
            if (dist < minDist) {
                minDist = dist;
                nearest = point;
            }
        }

        return minDist < Config.instance.SnapDistance ? nearest : undefined;
    }

    protected findSnapPoint(shapeType: ShapeType, view: IView, event: PointerEvent) {
        const featurePoint = this.findNearestFeaturePoint(view, event);
        if (featurePoint) {
            this._snaped = {
                view,
                point: featurePoint.point,
                info: featurePoint.prompt,
                shapes: [],
                type: "feature",
            };
        } else {
            const detected = this.detectShapes(shapeType, view, event);
            for (const snap of this.snaps) {
                const snaped = snap.snap(detected);
                if (snaped && this.validateSnapPoint(snaped)) {
                    this._snaped = snaped;
                    return;
                }
            }
        }
    }

    private validateSnapPoint(snaped: SnapResult) {
        return !this.data.validator || this.data.validator(snaped.point!);
    }

    private detectShapes(shapeType: ShapeType, view: IView, event: MouseEvent): MouseAndDetected {
        const shapes = view.detectShapes(shapeType, event.offsetX, event.offsetY, this.data.filter);
        return { shapes, view, mx: event.offsetX, my: event.offsetY };
    }

    protected clearSnapPrompt() {
        PubSub.default.pub("clearFloatTip");
    }

    protected showSnapPrompt(snaped: SnapResult) {
        const prompt = this.formatSnapPrompt(snaped);
        if (!prompt) {
            this.clearSnapPrompt();
            return;
        }
        PubSub.default.pub("showFloatTip", prompt);
    }

    protected formatSnapPrompt(
        snaped: SnapResult,
    ): HTMLElement | { level: MessageType; msg: string } | undefined {
        let prompt = this.data.prompt?.(snaped);
        if (!prompt) {
            const distance = snaped.distance ?? snaped.refPoint?.distanceTo(snaped.point!);
            if (distance) {
                prompt = this.formatSnapDistance(distance);
            }
        }

        if (!prompt && !snaped.info) {
            return undefined;
        }

        return {
            level: "info",
            msg: [snaped.info, prompt].filter((x) => x !== undefined).join(" -> "),
        };
    }

    // Shared by every snap handler, so routing it through UnitSetup makes the live
    // cursor tooltip honour the drawing's configured units - the same formatting the
    // user typed in (see UnitSetup.tryParseLength on the input side).
    protected formatSnapDistance(num: number) {
        return UnitSetup.formatLength(num);
    }

    private removeTempVisuals() {
        this.removeTempShapes();
        this.snaps.forEach((snap) => snap.removeDynamicObject());
    }

    private showTempShape(point: XYZ | undefined) {
        if (point && this.showTempPoint) {
            this._tempPoint = this.document.visual.context.displayMesh([this.acquiredSnapMesh(point)]);
        }

        this._tempShapes = this.data
            .preview?.(point)
            ?.map((shape) => this.document.visual.context.displayMesh([shape], this.facePreviewOpion));
    }

    /**
     * What marks the point the cursor has actually acquired. When the snap has an
     * AutoCAD glyph - a square for an endpoint, a triangle for a midpoint - that glyph
     * is drawn in the acquired colour, so it stands out from the paler markers
     * ObjectSnap puts on the other key points of the same object. Snaps with no glyph
     * (typed input, tracking, axis locks) keep the plain point.
     */
    private acquiredSnapMesh(point: XYZ): ShapeMeshData {
        const view = this._snaped?.view ?? this.document.application.activeView;
        const type = this._snaped?.type;
        const marker = view && type && snapMarkerMesh(view, type, point, VisualConfig.snapAcquiredColor);

        return (
            marker ??
            MeshDataUtils.createVertexMesh(
                point,
                VisualConfig.temporaryVertexSize,
                VisualConfig.temporaryVertexColor,
            )
        );
    }

    private removeTempShapes() {
        if (this._tempPoint) {
            this.document.visual.context.removeMesh(this._tempPoint);
            this._tempPoint = undefined;
        }
        this._tempShapes?.forEach((id) => {
            this.document.visual.context.removeMesh(id);
        });
        this.document.visual.update();
        this._tempShapes = undefined;
    }

    pointerDown(view: IView, event: PointerEvent): void {
        if (event.pointerType === "mouse" && event.button === 0) {
            if (this._snaped) {
                this.handleSuccess();
            } else {
                PubSub.default.pub("showToast", "toast.snap.notFoundValidPoint");
            }
        }
    }

    pointerUp(view: IView, event: PointerEvent): void {
        if (event.pointerType !== "mouse" && event.isPrimary && this._snaped) {
            this.handleSuccess();
        }
    }

    pointerOut(view: IView, event: PointerEvent) {
        this._snaped = undefined;
    }

    mouseWheel(view: IView, event: WheelEvent): void {
        view.update();
    }

    keyDown(view: IView, event: KeyboardEvent): void {
        this.data.onKeyDown?.(event, () => {
            this.removeTempShapes();
            this.showTempShape(this._snaped?.point);
            view.document.visual.update();
        });

        if (event.key === "Escape") {
            this._snaped = undefined;
            this.handleCancel();
        } else if (event.key === "Tab" && this._dynamicShown) {
            // Tab moves into the boxes, and from there the widget's own two fields
            // hand focus back and forth - AutoCAD's distance-then-angle rhythm.
            event.preventDefault();
            PubSub.default.pub("focusDynamicInput", "");
        } else if (event.key === "Enter" || event.key === " ") {
            // Space is Enter at a prompt, as it is in AutoCAD. Neither must reach
            // HotKeyService.
            event.preventDefault();
            event.stopImmediatePropagation();
            this.takeEnterDefault(view);
        } else {
            this.handleTypedInput(view, event);
        }
    }

    /**
     * Enter either takes the prompt's `<...>` default or backs out of the prompt.
     * Only a prompt that declares an onEnter has a default, so every other prompt
     * keeps Enter's original meaning of "no answer" (see SnapData.onEnter).
     */
    private takeEnterDefault(view: IView) {
        const point = this.data.onEnter?.();
        if (!point) {
            this._snaped = undefined;
            this.handleCancel();
            return;
        }

        this._snaped = { view, point, shapes: [], type: "input" };
        this.handleSuccess();
    }

    private handleTypedInput(view: IView, event: KeyboardEvent) {
        if (!this.canStartTyping(event.key)) return;

        // With the boxes up, a typed number is a distance - it belongs in them, not
        // in a second box that would cover them and mean something different. Option
        // keys still fall through to the flyout, since the boxes take numbers only.
        if (this._dynamicShown && /[0-9.-]/.test(event.key)) {
            event.preventDefault();
            PubSub.default.pub("focusDynamicInput", event.key);
            return;
        }

        this._state = "inputing";
        PubSub.default.pub("showInput", event.key, (text: string) => {
            // An option key wins over a coordinate: "3P" is a mode, not a number, and
            // the option list is short and explicit enough that nothing else collides.
            const option = this.matchOption(text);
            if (option) {
                option.onSelect();
                return Result.ok(text);
            }

            const error = this.inputError(text);
            if (error) return Result.err(error);

            this._snaped = this.getPointFromInput(view, text);
            this.handleSuccess();
            return Result.ok(text);
        });
    }

    /**
     * Which keystrokes open the typing box. Digits and coordinate punctuation always
     * do, as before. A letter only does when this prompt actually offers an option it
     * could be spelling - otherwise letters stay inert during a pick, the way they
     * were before options existed.
     */
    private canStartTyping(key: string) {
        if (["#", "-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(key)) return true;
        return key.length === 1 && /[a-z]/i.test(key) && hasStepOptions(this.data.options);
    }

    private matchOption(text: string) {
        return matchStepOption(this.data.options, text);
    }

    protected abstract getPointFromInput(view: IView, text: string): SnapResult;
    protected abstract inputError(text: string): I18nKeys | undefined;
}
