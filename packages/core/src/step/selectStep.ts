import type { IDocument } from "../document";
import { type AsyncController, PubSub } from "../foundation";
import type { I18nKeys } from "../i18n";
import type { ShapeNode } from "../model";
import type { INodeFilter, IShapeFilter } from "../selectionFilter";
import { type ShapeType, ShapeTypeUtils } from "../shape";
import { resolveStepOptions, type SnapResult, type StepOptions } from "../snap";
import type { VisualShapeData, VisualState } from "../visual";
import type { IStep } from "./step";

export interface SelectShapeOptions {
    multiple?: boolean;
    nodeFilter?: INodeFilter;
    shapeFilter?: IShapeFilter;
    selectedState?: VisualState;
    highlightState?: VisualState;
    keepSelection?: boolean;
    /** In multiple mode, finish the selection automatically once this returns true. */
    canFinish?: (selected: VisualShapeData[]) => boolean;
    beforeSelection?: () => void;
    afterSelection?: () => void;
    /**
     * The bracketed alternatives this prompt offers, exactly as a point step's are:
     * `FILLET Select first object or [Radius]:`.
     *
     * A selection prompt is still a prompt, and AutoCAD offers settings at plenty of
     * them. Without this a command like Fillet can only put its radius in the ribbon's
     * property panel, so the status bar says one thing, the command line takes another,
     * and typing `R` at the prompt does nothing at all.
     */
    stepOptions?: StepOptions;
}

export interface SelectNodeOptions {
    multiple?: boolean;
    filter?: INodeFilter;
    keepSelection?: boolean;
}

export abstract class SelectStep implements IStep {
    constructor(
        readonly snapeType: ShapeType,
        readonly prompt: I18nKeys,
        readonly options?: SelectShapeOptions,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        if (!this.options?.keepSelection) {
            document.selection.clearSelection();
        }

        this.options?.beforeSelection?.();
        // Re-derived rather than published once, for the same reason a point step does
        // it: an option that reports a value - Fillet's `[Radius]` - has to say the new
        // one the moment it changes, wherever it was changed from.
        const refresh = () => {
            PubSub.default.pub("showStepOptions", resolveStepOptions(this.options?.stepOptions));
        };
        PubSub.default.sub("refreshStepPrompt", refresh);
        refresh();

        return Promise.try(this.select.bind(this), document, controller).finally(() => {
            PubSub.default.remove("refreshStepPrompt", refresh);
            PubSub.default.pub("clearStepOptions");
            this.options?.afterSelection?.();
        });
    }

    abstract select(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined>;
}

export class SelectShapeStep extends SelectStep {
    override async select(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const shapes = await document.picker.pickShape(this.prompt, controller, {
            shapeType: this.snapeType,
            shapeFilter: this.options?.shapeFilter,
            nodeFilter: this.options?.nodeFilter,
            multi: this.options?.multiple,
            selectedState: this.options?.selectedState,
            highlightState: this.options?.highlightState,
            canFinish: this.options?.canFinish,
            stepOptions: this.options?.stepOptions,
        });
        if (shapes.length === 0) return undefined;
        return {
            view: document.application.activeView!,
            shapes,
            nodes: shapes.map((x) => x.owner.node),
            type: "shape",
        };
    }
}

export class GetOrSelectShapeStep extends SelectShapeStep {
    override execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const shapes = document.selection.getSelectedShapes().filter((x) => {
            let isValid = ShapeTypeUtils.contains(this.snapeType, x.shape.shapeType);
            if (this.options?.shapeFilter?.allow) {
                isValid &&= this.options.shapeFilter.allow(x.shape, x.transform);
            }
            if (this.options?.nodeFilter?.allow) {
                isValid &&= this.options.nodeFilter.allow(x.owner.node);
            }

            return isValid;
        });

        if (shapes.length > 0) {
            controller.success();
            return Promise.resolve({
                view: document.application.activeView!,
                shapes,
                nodes: shapes.map((x) => x.owner.node),
                type: "shape",
            });
        }

        return super.execute(document, controller);
    }
}

export class SelectNodeStep implements IStep {
    constructor(
        readonly prompt: I18nKeys,
        readonly options?: SelectNodeOptions,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        if (!this.options?.keepSelection) {
            document.selection.clearSelection();
        }

        return Promise.try(async () => {
            const nodes = await document.picker.pickNode(this.prompt, controller, {
                nodeFilter: this.options?.filter,
                multi: this.options?.multiple,
            });
            if (nodes.length === 0) return undefined;
            return {
                view: document.application.activeView!,
                shapes: [],
                nodes,
                type: "node",
            } satisfies SnapResult;
        });
    }
}

export class GetOrSelectNodeStep extends SelectNodeStep {
    override execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const selected = document.selection.getSelectedNodes().filter((x) => {
            if (this.options?.filter?.allow) {
                return this.options.filter.allow(x);
            }

            return true;
        });

        if (selected.length > 0) {
            controller.success();
            return Promise.resolve({
                view: document.application.activeView!,
                shapes: [],
                nodes: selected as ShapeNode[],
                type: "node",
            });
        }

        return super.execute(document, controller);
    }
}
