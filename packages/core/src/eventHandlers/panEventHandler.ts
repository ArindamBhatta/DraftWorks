import type { AsyncController } from "../foundation";
import { PubSub } from "../foundation";
import type { IEventHandler, IView } from "../visual";

const LEFT_BUTTON = 1;

/**
 * AutoCAD's PAN command: while it is running the left button drags the view instead of
 * selecting, and the pointer becomes the grab hand. This is the modal counterpart to
 * the always-available middle-drag pan in ThreeViewHandler - the two coexist the same
 * way they do in AutoCAD, where the wheel-drag never stops working.
 *
 * The command ends on ESC or ENTER, both routed through the controller so the owning
 * command's await resolves.
 */
export class PanEventHandler implements IEventHandler {
    private _lastPoint: { x: number; y: number } | undefined;

    isEnabled = true;

    constructor(readonly controller: AsyncController) {}

    dispose() {
        this._lastPoint = undefined;
    }

    pointerDown(view: IView, event: PointerEvent): void {
        if (event.button !== 0) return;
        this._lastPoint = { x: event.offsetX, y: event.offsetY };
        PubSub.default.pub("viewCursor", "pan.active");
    }

    pointerMove(view: IView, event: PointerEvent): void {
        if (!this._lastPoint || (event.buttons & LEFT_BUTTON) === 0) return;

        view.cameraController.pan(event.offsetX - this._lastPoint.x, event.offsetY - this._lastPoint.y);
        this._lastPoint = { x: event.offsetX, y: event.offsetY };
        view.update();
    }

    pointerUp(view: IView, event: PointerEvent): void {
        this.endDrag();
    }

    pointerOut(view: IView, event: PointerEvent): void {
        this.endDrag();
    }

    private endDrag() {
        if (!this._lastPoint) return;
        this._lastPoint = undefined;
        PubSub.default.pub("viewCursor", "pan");
    }

    mouseWheel(view: IView, event: WheelEvent): void {
        view.cameraController.zoom(event.offsetX, event.offsetY, event.deltaY);
        view.update();
    }

    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape" || event.key === "Enter") {
            this.controller.cancel();
        }
    }
}
