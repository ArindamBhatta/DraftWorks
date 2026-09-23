// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config } from "../config";
import type { IDocument } from "../document";
import { type AsyncController, PubSub } from "../foundation";
import { I18n } from "../i18n";
import type { INode } from "../model";
import type { INodeFilter } from "../selectionFilter";
import { ShapeTypes } from "../shape";
import { type IView, type IVisualObject, VisualStates } from "../visual";
import { SelectionHandler } from "./selectionEventHandler";

export class NodeSelectionHandler extends SelectionHandler {
    private _highlights: IVisualObject[] | undefined;
    private _detectAtMouse: IVisualObject[] | undefined;
    private _lockDetected: IVisualObject | undefined; // Used for cycling detected objects
    protected highlighState = VisualStates.edgeHighlight;

    /** In multi mode, finish the pick automatically once this returns true. */
    canFinish?: (selected: INode[]) => boolean;

    constructor(
        document: IDocument,
        multiMode: boolean,
        controller?: AsyncController,
        readonly filter?: INodeFilter,
    ) {
        super(document, multiMode, controller);
    }

    protected override canFinishSelection(): boolean {
        return this.canFinish?.(this.document.selection.getSelectedNodes()) ?? false;
    }

    protected override select(view: IView, event: PointerEvent): number {
        if (!this._highlights?.length) {
            this.clearSelected(this.document);
            return 0;
        }
        const models = this._highlights
            .map((x) => view.document.visual.context.getNode(x))
            .filter((x) => x !== undefined);

        return this.document.selection.setSelectedNodes(models, this.toggleSelect(event));
    }

    /**
     * AutoCAD's selection cycling. A click that lands on a stack of objects offers the
     * stack instead of silently taking whichever happened to be drawn on top - which is
     * the whole difficulty with overlapping geometry: the topmost is rarely the one
     * meant, and there is no way to tell from the drawing which one you got.
     *
     * Only for a plain click on more than one object. A rectangle drag means the whole
     * region, a shift-click is adding to a set, and a click on a single object has
     * nothing to disambiguate - in all three the menu would be in the way.
     */
    protected override tryCycleSelection(view: IView, event: PointerEvent): boolean {
        if (!Config.instance.enableSelectionCycling) return false;
        if (this.isRectDrag(event) || this.toggleSelect(event)) return false;

        const candidates = this._detectAtMouse;
        if (!candidates || candidates.length < 2) return false;

        PubSub.default.pub("showSelectionCycle", {
            clientX: event.clientX,
            clientY: event.clientY,
            items: candidates.map((candidate) => ({
                name: this.describe(view, candidate),
                detail: this.layerOf(view, candidate),
                // Hovering a row lights that object up in the drawing, so the names in
                // the list can be matched to the geometry without picking one first.
                onHover: () => this.highlightDetecteds(view, [candidate]),
                onPick: () => {
                    const node = view.document.visual.context.getNode(candidate);
                    this.cleanHighlights();
                    if (node) this.document.selection.setSelectedNodes([node], false);
                    view.update();
                    if (!this.multiMode) this.controller?.success();
                },
            })),
            onCancel: () => {
                this.cleanHighlights();
                view.update();
            },
        });
        return true;
    }

    /** What a row in the cycling list reads. */
    private describe(view: IView, candidate: IVisualObject): string {
        return view.document.visual.context.getNode(candidate)?.name ?? I18n.translate("common.name");
    }

    /**
     * The layer shown beside the name, which is usually what tells two rows apart - a
     * stack of overlapping objects is very often several of the same kind, and "Line,
     * Line, Line" is not a choice anyone can make.
     *
     * The layer, not the tree parent: a node's layer is `layerId` on it (layers are
     * orthogonal to the tree - see Layer), so `parent` would name the folder it was
     * grouped into, which is a different question.
     */
    private layerOf(view: IView, candidate: IVisualObject): string | undefined {
        const node = view.document.visual.context.getNode(candidate);
        if (!node || !("layerId" in node)) return undefined;
        return this.document.modelManager.layerOf(node as { layerId?: string }).name;
    }

    /**
     * Whether this click adds to the selection instead of replacing it.
     *
     * At a command's "Select objects:" prompt every click has to add, the way it does
     * in AutoCAD - otherwise picking the second line of an exploded rectangle throws
     * away the first, and a multi-object command can never be given more than one
     * object. ShapeSelectionHandler already selects this way (it passes multiMode
     * straight through as its toggle), which is why picking several edges or vertices
     * has always worked while picking several objects did not.
     *
     * Outside a multi-pick, shift is still what turns a click into an add.
     */
    protected toggleSelect(event: PointerEvent) {
        return this.multiMode || event.shiftKey;
    }

    getDetecteds(view: IView, event: PointerEvent) {
        if (this.isRectDrag(event)) {
            // Drag corners in the order they were dragged, never sorted: the direction
            // is what tells detectVisualRect whether this is a window or a crossing.
            return view.detectVisualRect(
                this.mouse.x,
                this.mouse.y,
                event.offsetX,
                event.offsetY,
                this.filter,
            );
        }
        this._detectAtMouse = view.detectVisual(event.offsetX, event.offsetY, this.filter);
        const detected = this.getDetecting();
        return detected ? [detected] : [];
    }

    private getDetecting() {
        if (!this._detectAtMouse) return undefined;
        const index = this._lockDetected ? this.getDetcedtingIndex() : 0;
        return this._detectAtMouse[index] || undefined;
    }

    private getDetcedtingIndex() {
        if (!this._detectAtMouse) return -1;
        for (let i = 0; i < this._detectAtMouse.length; i++) {
            if (this._lockDetected === this._detectAtMouse[i]) {
                return i;
            }
        }
        return -1;
    }

    override pointerMove(view: IView, event: PointerEvent): void {
        super.pointerMove(view, event);
        this._lockDetected = undefined;
    }

    protected override setHighlight(view: IView, event: PointerEvent) {
        const detecteds = this.getDetecteds(view, event);
        this.highlightDetecteds(view, detecteds);
    }

    private highlightDetecteds(view: IView, detecteds: IVisualObject[]) {
        this.cleanHighlights();
        detecteds.forEach((x) => {
            view.document.visual.highlighter.addState(x, this.highlighState, ShapeTypes.shape);
        });
        this._highlights = detecteds;
        view.update();
    }

    protected override cleanHighlights(): void {
        this._highlights?.forEach((x) => {
            this.document.visual.highlighter.removeState(x, this.highlighState, ShapeTypes.shape);
        });
        this._highlights = undefined;
    }

    protected override highlightNext(view: IView): void {
        if (this._detectAtMouse && this._detectAtMouse.length > 1) {
            const index = this._lockDetected
                ? (this.getDetcedtingIndex() + 1) % this._detectAtMouse.length
                : 1;
            this._lockDetected = this._detectAtMouse[index];
            const detected = this.getDetecting();
            if (detected) this.highlightDetecteds(view, [detected]);
        }
    }
}
