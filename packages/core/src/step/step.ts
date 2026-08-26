import type { IDocument } from "../document";
import { type AsyncController, PubSub } from "../foundation";
import type { I18nKeys } from "../i18n";
import type { XYZ } from "../math";
import { resolveStepOptions, type SnapData, type SnapEventHandler, type SnapResult } from "../snap";
import type { CursorType } from "../visual";

export interface IStep {
    execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined>;
}

/**
 * A prompt's text, fixed or re-derived on demand - the tip counterpart to
 * StepOptions. Circle's second prompt reads "Specify radius of circle" or "Specify
 * diameter of circle" depending on a setting the user can flip mid-prompt, so it
 * has to be re-asked rather than captured once.
 */
export type StepTip = I18nKeys | (() => I18nKeys);

export abstract class SnapStep<D extends SnapData> implements IStep {
    protected cursor: CursorType = "draw";

    constructor(
        readonly tip: StepTip,
        private readonly handleStepData: () => D,
        private readonly keepSelected: boolean = false,
    ) {}

    resolveTip(): I18nKeys {
        return typeof this.tip === "function" ? this.tip() : this.tip;
    }

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        if (!this.keepSelected) {
            document.selection.clearSelection();
        }

        const data = this.handleStepData();
        if (data.beforeExecute) {
            data.beforeExecute();
        }

        this.setValidator(data);

        const executorHandler = this.getEventHandler(document, controller, data);
        // While this prompt is the live one it owns the status bar, and it re-derives
        // itself on demand: anything that changes the command state the prompt reads
        // publishes refreshStepPrompt, and the tip and options are re-asked here. That
        // is what keeps the prompt, its clickable options and the ribbon's property
        // panel showing the same thing no matter which of them the user drove.
        const refresh = () => this.publishPrompt(data);
        PubSub.default.sub("refreshStepPrompt", refresh);
        try {
            refresh();
            await document.picker.pickAsync(
                executorHandler,
                this.resolveTip(),
                controller,
                false,
                this.cursor,
            );
        } finally {
            PubSub.default.remove("refreshStepPrompt", refresh);
            PubSub.default.pub("clearStepOptions");
        }
        const snaped = executorHandler.snaped;

        executorHandler.dispose();
        if (data.afterExecute) {
            data.afterExecute();
        }

        return controller.result?.status === "success" ? snaped : undefined;
    }

    private publishPrompt(data: D) {
        PubSub.default.pub("statusBarTip", this.resolveTip());
        PubSub.default.pub("showStepOptions", resolveStepOptions(data.options));
    }

    private setValidator(data: D) {
        const oldValidator = data.validator;
        data.validator = (point) => {
            if (oldValidator) {
                return oldValidator(point) && this.validator(data, point);
            }
            return this.validator(data, point);
        };
    }

    protected abstract getEventHandler(
        document: IDocument,
        controller: AsyncController,
        data: D,
    ): SnapEventHandler;

    protected abstract validator(data: D, point: XYZ): boolean;
}
