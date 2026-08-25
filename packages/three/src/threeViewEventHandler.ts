// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IEventHandler, IView } from "@chili3d/core";

interface MouseDownData {
    time: number;
    key: number;
}

const MOUSE_MIDDLE = 4;

/**
 * View navigation for a 2D drafting view: middle-drag pans, wheel zooms, middle
 * double-click fits. There is no orbit - the camera is locked to a plan projection
 * (see ICameraController), so the old rotate bindings and the per-CAD-vendor
 * navigation profiles that selected between them are gone.
 */
export class ThreeViewHandler implements IEventHandler {
    private _lastDown: MouseDownData | undefined;
    private _clearDownId: number | undefined;
    private _offsetPoint: { x: number; y: number } | undefined;
    protected lastPointerEventMap: Map<number, PointerEvent> = new Map();
    protected currentPointerEventMap: Map<number, PointerEvent> = new Map();

    isEnabled = true;

    dispose() {
        this.clearTimeout();
        this.lastPointerEventMap.clear();
        this.currentPointerEventMap.clear();
    }

    mouseWheel(view: IView, event: WheelEvent): void {
        view.cameraController.zoom(event.offsetX, event.offsetY, event.deltaY);
        view.update();
    }

    pointerMove(view: IView, event: PointerEvent): void {
        if (event.pointerType === "mouse") {
            this.handleMouseMove(view, event);
        } else {
            this.handleTouchMove(view, event);
        }

        view.update();
    }

    private handleMouseMove(view: IView, event: PointerEvent) {
        if (event.buttons !== MOUSE_MIDDLE) {
            return;
        }

        let dx = 0;
        let dy = 0;
        if (this._offsetPoint) {
            dx = event.offsetX - this._offsetPoint.x;
            dy = event.offsetY - this._offsetPoint.y;
            this._offsetPoint = { x: event.offsetX, y: event.offsetY };
        }

        view.cameraController.pan(dx, dy);

        if (dx !== 0 && dy !== 0) this._lastDown = undefined;
    }

    private handleTouchMove(view: IView, event: PointerEvent) {
        if (!this.currentPointerEventMap.has(event.pointerId)) {
            this.currentPointerEventMap.set(event.pointerId, event);
            return;
        }

        // Two-finger gestures only - the three-finger orbit gesture is gone with the
        // rest of the 3D navigation.
        if (this.currentPointerEventMap.size === 2 && this.lastPointerEventMap.size === 2) {
            const last = this.getCenterAndDistance(this.lastPointerEventMap);
            const current = this.getCenterAndDistance(this.currentPointerEventMap);
            const dtCenter = this.distance(current.center.x, current.center.y, last.center.x, last.center.y);
            const dtDistance = current.distance - last.distance;
            if (dtCenter > Math.abs(dtDistance) * 0.5) {
                // 0.5 no meaning, just for scale
                view.cameraController.pan(current.center.x - last.center.x, current.center.y - last.center.y);
            } else {
                view.cameraController.zoom(current.center.x, current.center.y, -dtDistance);
            }
        }

        this.lastPointerEventMap.clear();
        this.lastPointerEventMap = this.currentPointerEventMap;
        this.currentPointerEventMap = new Map();
    }

    private getCenterAndDistance(pointerEvents: Map<number, PointerEvent>) {
        const values = pointerEvents.values();
        const first = values.next().value!;
        const second = values.next().value!;
        const center = {
            x: (first.offsetX + second.offsetX) / 2,
            y: (first.offsetY + second.offsetY) / 2,
        };
        const distance = this.distance(first.offsetX, second.offsetX, first.offsetY, second.offsetY);
        return { center, distance };
    }

    private distance(x1: number, y1: number, x2: number, y2: number) {
        return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
    }

    pointerDown(view: IView, event: PointerEvent): void {
        this.clearTimeout();
        if (event.pointerType === "mouse") {
            this.handleMouseDown(event, view);
        } else {
            this.lastPointerEventMap.set(event.pointerId, event);
        }
    }

    private handleMouseDown(event: PointerEvent, view: IView) {
        if (this._lastDown && this._lastDown.time + 500 > Date.now() && event.buttons === MOUSE_MIDDLE) {
            this._lastDown = undefined;
            view.cameraController.fitContent();
            view.update();
        } else if (event.buttons === MOUSE_MIDDLE) {
            this._lastDown = {
                time: Date.now(),
                key: event.buttons,
            };
            this._offsetPoint = { x: event.offsetX, y: event.offsetY };
        }
    }

    private clearTimeout() {
        if (this._clearDownId) {
            clearTimeout(this._clearDownId);
            this._clearDownId = undefined;
        }
    }

    pointerOut(view: IView, event: PointerEvent): void {
        this._lastDown = undefined;
        this.lastPointerEventMap.delete(event.pointerId);
        this.currentPointerEventMap.delete(event.pointerId);
    }

    pointerUp(view: IView, event: PointerEvent): void {
        if (event.buttons === MOUSE_MIDDLE && this._lastDown) {
            this._clearDownId = window.setTimeout(() => {
                this._lastDown = undefined;
                this._clearDownId = undefined;
            }, 500);
        }
        this._offsetPoint = undefined;
        this.lastPointerEventMap.delete(event.pointerId);
        this.currentPointerEventMap.delete(event.pointerId);
    }

    keyDown(view: IView, event: KeyboardEvent): void {}
}
