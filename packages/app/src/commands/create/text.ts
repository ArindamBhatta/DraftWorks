// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CancelableCommand,
    command,
    DimensionSetup,
    Dimensions,
    hideCommandProperty,
    I18n,
    type I18nKeys,
    type IStep,
    MeshDataUtils,
    type Plane,
    type PointSnapData,
    PointStep,
    Precision,
    PubSub,
    promptForValue,
    property,
    Result,
    type ShapeMeshData,
    TextAnnotation,
    Transaction,
    UnitSetup,
    VisualConfig,
    type XYZ,
} from "@chili3d/core";
import { div, label, textarea } from "@chili3d/element";

/**
 * Reads a typed text height: a length in the drawing's units, or an empty line to keep
 * the remembered one. Zero and negative heights are rejected rather than clamped -
 * silently drawing text at a size nobody asked for is worse than asking again.
 * Exported for testing.
 */
export function parseTextHeight(text: string, remembered: number): number | undefined {
    const trimmed = text.trim();
    if (trimmed === "") return remembered > Precision.Distance ? remembered : undefined;

    const value = UnitSetup.tryParseLength(trimmed);
    return value !== undefined && value > Precision.Distance ? value : undefined;
}

/**
 * Reads a typed rotation in degrees, or an empty line to keep the remembered angle.
 * Any finite angle is allowed, including negative and past 360 - AutoCAD normalises
 * these rather than refusing them. Exported for testing.
 */
export function parseTextRotation(text: string, remembered: number): number | undefined {
    const trimmed = text.trim();
    if (trimmed === "") return remembered;

    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return undefined;
    const value = Number.parseFloat(trimmed);
    return Number.isFinite(value) ? value : undefined;
}

/**
 * Shared plumbing for TEXT and MTEXT: the height prompt, the step runner, and the one
 * place that actually adds a TextAnnotation to the drawing.
 */
abstract class TextCommandBase extends CancelableCommand {
    /**
     * The remembered text height, offered as the prompt's default. A property only so
     * CancelableCommand's cache carries it between invocations; hidden from the command
     * bar because the prompt already offers it and parses drawing units the bar's plain
     * number box would not.
     */
    @property("annotation.text.height")
    get height(): number {
        return this.getPrivateValue("height", DimensionSetup.settings.textHeight);
    }
    set height(value: number) {
        this.setProperty("height", value);
    }

    protected async runStep(step: IStep) {
        this.controller = new AsyncController();
        const data = await step.execute(this.document, this.controller);
        return this.controller?.result?.status === "success" ? data : undefined;
    }

    /** "Specify height <2.5>". Returns false if the user backed out. */
    protected async askHeight(): Promise<boolean> {
        this.controller = new AsyncController();
        const answer = await promptForValue({
            controller: this.controller,
            statusTip: "prompt.text.height",
            message: I18n.translate("prompt.text.height{0}", UnitSetup.formatLength(this.height)),
            parse: (text) => {
                const parsed = parseTextHeight(text, this.height);
                return parsed === undefined
                    ? Result.err<I18nKeys>("error.text.invalidHeight")
                    : Result.ok(parsed);
            },
        });
        if (answer === undefined) return false;

        this.height = answer;
        return true;
    }

    protected addText(options: { position: XYZ; content: string; rotation: number; boxWidth: number }) {
        const workplane = this.application.activeView!.workplane;
        Transaction.execute(this.document, I18n.translate("command.create.text"), () => {
            this.document.modelManager.addNode(
                new TextAnnotation({
                    document: this.document,
                    annotationType: "text",
                    name: I18n.translate("annotation.text"),
                    content: options.content,
                    position: options.position,
                    height: this.height,
                    rotation: options.rotation,
                    boxWidth: options.boxWidth,
                    normal: workplane.normal,
                    xAxis: workplane.xvec,
                }),
            );
            this.document.visual.update();
        });
    }

    protected markerAt(point: XYZ): ShapeMeshData {
        return MeshDataUtils.createVertexMesh(
            point,
            VisualConfig.editVertexSize,
            VisualConfig.editVertexColor,
        );
    }
}

/**
 * AutoCAD's TEXT/DTEXT (alias `DT`): one line of text placed on its left baseline.
 * Prompts for the start point, then the height and rotation - each offering the value
 * used last - and finally the text itself.
 */
@command({
    key: "create.text",
    icon: "icon-text",
})
export class SingleLineText extends TextCommandBase {
    /** Remembered separately from height so re-running the command keeps the angle too. */
    @property("annotation.text.rotation")
    get rotation(): number {
        return this.getPrivateValue("rotation", 0);
    }
    set rotation(value: number) {
        this.setProperty("rotation", value);
    }

    protected override async executeAsync(): Promise<void> {
        const start = await this.runStep(new PointStep("prompt.text.startPoint"));
        if (!start?.point) return;

        if (!(await this.askHeight())) return;
        if (!(await this.askRotation())) return;

        const content = await this.askContent();
        if (content === undefined) return;

        this.addText({ position: start.point, content, rotation: this.rotation, boxWidth: 0 });
    }

    private async askRotation(): Promise<boolean> {
        this.controller = new AsyncController();
        const answer = await promptForValue({
            controller: this.controller,
            statusTip: "prompt.text.rotation",
            message: I18n.translate("prompt.text.rotation{0}", this.rotation.toString()),
            parse: (text) => {
                const parsed = parseTextRotation(text, this.rotation);
                return parsed === undefined
                    ? Result.err<I18nKeys>("error.text.invalidAngle")
                    : Result.ok(parsed);
            },
        });
        if (answer === undefined) return false;

        this.rotation = answer;
        return true;
    }

    private async askContent(): Promise<string | undefined> {
        this.controller = new AsyncController();
        return promptForValue({
            controller: this.controller,
            statusTip: "prompt.text.content",
            message: I18n.translate("prompt.text.content"),
            parse: (text) => (text === "" ? Result.err<I18nKeys>("error.text.empty") : Result.ok(text)),
        });
    }
}

/**
 * AutoCAD's MTEXT (alias `T`): a paragraph that wraps inside a box you drag out. The
 * box's width is what the text wraps to; its height is only a hint, so the block is
 * hung from the top edge and allowed to run past the bottom, exactly as MTEXT does.
 *
 * The content is typed in a dialog rather than the one-line flyout box, because a
 * single-line input cannot express the line breaks that are the whole point of MTEXT.
 */
@command({
    key: "create.mtext",
    icon: "icon-mtext",
})
export class MultilineText extends TextCommandBase {
    protected override async executeAsync(): Promise<void> {
        const first = await this.runStep(new PointStep("prompt.mtext.firstCorner"));
        if (!first?.point) return;

        const opposite = await this.runStep(
            new PointStep("prompt.mtext.oppositeCorner", this.boxData(first.point)),
        );
        if (!opposite?.point) return;

        const box = this.textBox(first.point, opposite.point);
        if (!box) return;

        if (!(await this.askHeight())) return;

        const content = await this.askContent();
        if (content === undefined) return;

        this.addText({ position: box.topLeft, content, rotation: 0, boxWidth: box.width });
    }

    private readonly boxData = (first: XYZ) => (): PointSnapData => ({
        refPoint: () => first,
        dimension: Dimensions.D1D2D3,
        preview: (point: XYZ | undefined) => this.previewBox(first, point),
    });

    private previewBox(first: XYZ, point: XYZ | undefined): ShapeMeshData[] {
        if (!point) return [this.markerAt(first)];

        const plane = this.application.activeView!.workplane;
        const { x, y } = this.localOffset(plane, first, point);
        const alongX = first.add(plane.xvec.multiply(x));
        const alongY = first.add(plane.yvec.multiply(y));
        const edge = (a: XYZ, b: XYZ) =>
            MeshDataUtils.createEdgeMesh(a, b, VisualConfig.defaultEdgeColor, "solid");

        return [
            this.markerAt(first),
            edge(first, alongX),
            edge(alongX, point),
            edge(point, alongY),
            edge(alongY, first),
        ];
    }

    /** `to - from` expressed in the workplane's own axes. */
    private localOffset(plane: Plane, from: XYZ, to: XYZ): { x: number; y: number } {
        const delta = to.sub(from);
        return { x: delta.dot(plane.xvec), y: delta.dot(plane.yvec) };
    }

    /**
     * The dragged rectangle as a wrap width plus the corner the block hangs from. Which
     * way the box was dragged does not matter: MTEXT always fills from its top-left.
     */
    private textBox(first: XYZ, opposite: XYZ): { topLeft: XYZ; width: number } | undefined {
        const plane = this.application.activeView!.workplane;
        const { x, y } = this.localOffset(plane, first, opposite);
        if (Math.abs(x) <= Precision.Distance) return undefined;

        const left = Math.min(0, x);
        const top = Math.max(0, y);
        return {
            topLeft: first.add(plane.xvec.multiply(left)).add(plane.yvec.multiply(top)),
            width: Math.abs(x),
        };
    }

    private askContent(): Promise<string | undefined> {
        return new Promise((resolve) => {
            const editor = textarea({ rows: 6, cols: 40, spellcheck: false });
            const content = div(label({ textContent: I18n.translate("prompt.text.content") }), div(editor));
            // The dialog confirms on Enter, which would make newlines impossible in the
            // one field that exists for them. Only Enter is held back; Escape still
            // reaches the dialog and cancels.
            editor.addEventListener("keydown", (e) => {
                if (e.key === "Enter") e.stopPropagation();
            });
            setTimeout(() => editor.focus());

            PubSub.default.pub("showDialog", "dialog.title.mtext", content, [
                {
                    content: "common.confirm",
                    onclick: () => resolve(editor.value === "" ? undefined : editor.value),
                },
                { content: "common.cancel", onclick: () => resolve(undefined) },
            ]);
        });
    }
}

hideCommandProperty(SingleLineText.prototype, ["height", "rotation"]);
hideCommandProperty(MultilineText.prototype, ["height"]);
