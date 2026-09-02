// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import type { AsyncController } from "../foundation";
import { type IEventHandler, type IView, type RectSelectMode, rectSelectMode } from "../visual";

const MOUSE_MIDDLE = 4;

/**
 * How far the pointer has to travel before a press counts as dragging a selection
 * rectangle rather than clicking on an object - AutoCAD's pickbox, roughly. Either
 * axis on its own is enough: a window dragged along a wall is often only a couple of
 * pixels tall, and requiring travel in *both* axes made those picks fall back to a
 * single-object click.
 */
const RECT_DRAG_THRESHOLD = 3;

const SelectionRectStyle = `
    position: absolute;
    pointer-events: none;
    display: none;
    left: 0px;
    right: 0px;
    width: 0px;
    height: 0px;
`;

/**
 * AutoCAD's colours for the two rectangles, and the reason they are worth copying
 * exactly: the fill is the only thing telling you, mid-drag, whether you are about
 * to take just what is enclosed or everything you touched. Blue/solid is the window,
 * green/dashed the crossing - the dashed border repeats the same message for anyone
 * who cannot separate the two hues.
 */
const SelectionRectColors: Record<RectSelectMode, { border: string; background: string }> = {
    window: { border: "1px solid rgb(64, 128, 255)", background: "rgba(64, 128, 255, 0.22)" },
    crossing: { border: "1px dashed rgb(60, 200, 90)", background: "rgba(60, 200, 90, 0.22)" },
};

interface SelectionRect {
    element: HTMLElement;
    clientX: number;
    clientY: number;
}

export abstract class SelectionHandler implements IEventHandler {
    protected rect?: SelectionRect;
    protected showRect = true;
    protected mouse = { isDown: false, x: 0, y: 0 };
    protected readonly pointerEventMap: Map<number, PointerEvent> = new Map();

    isEnabled = true;

    constructor(
        readonly document: IDocument,
        protected multiMode: boolean,
        readonly controller?: AsyncController,
    ) {
        controller?.onCancelled((s) => {
            this.clearSelected(document);
            this.cleanHighlights();
        });
    }

    #disposed = false;
    readonly dispose = () => {
        if (!this.#disposed) {
            this.#disposed = true;

            this.disposeInternal();
        }
    };

    protected disposeInternal() {
        this.pointerEventMap.clear();
    }

    pointerMove(view: IView, event: PointerEvent): void {
        if (event.buttons === MOUSE_MIDDLE) return;
        if (this.rect) this.updateRect(this.rect, event);

        this.setHighlight(view, event);
    }

    protected abstract setHighlight(view: IView, event: PointerEvent): void;

    protected abstract cleanHighlights(): void;

    protected clearSelected(document: IDocument) {
        document.selection.clearSelection();
    }

    protected abstract select(view: IView, event: PointerEvent): number;

    protected abstract highlightNext(view: IView): void;

    /** In multi mode, returning true after a pick completes the selection immediately. */
    protected canFinishSelection(): boolean {
        return false;
    }

    pointerDown(view: IView, event: PointerEvent): void {
        event.preventDefault();
        if (event.button === 0 && event.isPrimary) {
            this.mouse = { isDown: true, x: event.offsetX, y: event.offsetY };
            if (this.multiMode && this.showRect) {
                this.rect = this.initRect(event);
            }
        }
        this.pointerEventMap.set(event.pointerId, event);
    }

    protected initRect(event: PointerEvent): SelectionRect {
        const rect = document.createElement("div");
        rect.style.cssText = SelectionRectStyle;
        this.document.application.mainWindow?.appendChild(rect);
        return { element: rect, clientX: event.clientX, clientY: event.clientY };
    }

    protected updateRect(rect: SelectionRect, event: PointerEvent) {
        if (this.pointerEventMap.size !== 1) return;
        rect.element.style.display = "block";
        const [x1, y1] = [Math.min(rect.clientX, event.clientX), Math.min(rect.clientY, event.clientY)];
        const [x2, y2] = [Math.max(rect.clientX, event.clientX), Math.max(rect.clientY, event.clientY)];
        const colors = SelectionRectColors[rectSelectMode(rect.clientX, event.clientX)];
        Object.assign(rect.element.style, {
            left: `${x1}px`,
            top: `${y1}px`,
            width: `${x2 - x1}px`,
            height: `${y2 - y1}px`,
            border: colors.border,
            backgroundColor: colors.background,
        });
    }

    /**
     * Whether the pointer has been dragged far enough for this pick to be a
     * rectangle rather than a click on whatever is under the cursor.
     */
    protected isRectDrag(event: PointerEvent): boolean {
        return (
            this.rect !== undefined &&
            (Math.abs(this.mouse.x - event.offsetX) > RECT_DRAG_THRESHOLD ||
                Math.abs(this.mouse.y - event.offsetY) > RECT_DRAG_THRESHOLD)
        );
    }

    pointerOut(view: IView, event: PointerEvent): void {
        if (event.isPrimary) {
            this.mouse.isDown = false;
            this.removeRect(view);
            this.cleanHighlights();
        }
        this.pointerEventMap.delete(event.pointerId);
    }

    pointerUp(view: IView, event: PointerEvent): void {
        event.preventDefault();

        if (this.mouse.isDown && event.isPrimary) {
            this.mouse.isDown = false;
            this.removeRect(view);
            const count = this.select(view, event);
            this.cleanHighlights();
            view.update();
            if (count > 0 && (!this.multiMode || this.canFinishSelection())) this.controller?.success();
        }
        this.pointerEventMap.delete(event.pointerId);
    }

    protected removeRect(view: IView) {
        this.rect?.element.remove();
        this.rect = undefined;
    }

    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this.controller ? this.controller.cancel() : this.clearSelected(view.document.visual.document);
            this.cleanHighlights();
        } else if (event.key === "Enter" || event.key === " ") {
            // DefaultEventHandler is should pass Enter/Space to HotkeyService,
            if (this !== this.document.visual.defaultEventHandler) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
            this.cleanHighlights();
            this.controller?.success(); // accept selection
        } else if (event.key === "Tab") {
            event.preventDefault();
            this.highlightNext(view);
        }
    }
}
