import {
    AsyncController,
    Combobox,
    Config,
    command,
    Dimensions,
    type GeometryNode,
    type I18nKeys,
    type IStep,
    LengthAtPlaneStep,
    MathUtils,
    Plane,
    type PointSnapData,
    PointStep,
    PubSub,
    promptForValue,
    property,
    Result,
    type SnapLengthAtPlaneData,
    type SnapResult,
    type StepOption,
    UnitSetup,
    type XYZ,
} from "@draftworks/core";
import { RectNode } from "../../bodys";
import { CreateCommand } from "../createCommand";

export interface RectData {
    plane: Plane;
    dx: number;
    dy: number;
}

/** What RECTANG does to the corners - the panel's form of its `[Chamfer/Fillet]`. */
export type CornerMode =
    | "option.rect.cornerMode.none"
    | "option.rect.cornerMode.fillet"
    | "option.rect.cornerMode.chamfer";

export function getReactData(atPlane: Plane, start: XYZ, end: XYZ): RectData {
    const plane = new Plane({ origin: start, normal: atPlane.normal, xvec: atPlane.xvec });
    const vector = end.sub(start);
    const dx = vector.dot(plane.xvec);
    const dy = vector.dot(plane.yvec);
    return { plane, dx, dy };
}

/**
 * A corner setback typed at the prompt, in drawing units.
 *
 * Enter alone takes the remembered value, AutoCAD's `<...>`. Zero is a real answer - it
 * is how square corners come back - so unlike an offset distance this accepts it, and
 * rejects only what is negative or not a length at all. Exported for testing.
 */
export function parseSetback(text: string, remembered: number): Result<number, I18nKeys> {
    const trimmed = text.trim();
    if (trimmed === "") return Result.ok(remembered);

    const value = UnitSetup.tryParseLength(trimmed);
    if (value === undefined || value < 0) return Result.err<I18nKeys>("error.rect.invalidSetback");
    return Result.ok(value);
}

export abstract class RectCommandBase extends CreateCommand {
    protected getSteps(): IStep[] {
        return [
            new PointStep("prompt.pickFistPoint", this.firstSnapData),
            new LengthAtPlaneStep("prompt.pickNextPoint", this.nextSnapData),
        ];
    }

    /**
     * `RECTANG Specify first corner point or [Chamfer/Fillet]:` for the commands that
     * offer corner treatments, and a plain pick for those that do not - see cornerOptions.
     */
    private readonly firstSnapData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        options: () => this.cornerOptions(),
    });

    /**
     * The corner options this command offers at its first prompt. Empty here: the base
     * is shared with commands that draw a rectangle without RECTANG's options, and an
     * empty list is what tells the prompt to show no brackets at all.
     */
    protected cornerOptions(): StepOption[] {
        return [];
    }

    /**
     * Steps out of the pick to ask a sub-question, then puts the pick back.
     *
     * RECTANG's options interrupt the first prompt rather than following it: the answer
     * changes the rectangle about to be drawn, so the pick has to be re-offered once it
     * is in. Restarting is how a step sequence re-asks - see CancelableCommand.restart.
     *
     * The pick underneath is still running while the question is up, and it keeps its
     * controller: that controller is the one pickAsync is waiting on, so a question that
     * took it over would leave the drawing in a pick nothing could ever finish. The
     * question brings its own - see askCornerSize.
     */
    protected async askThenRestart(ask: () => Promise<void>): Promise<void> {
        const pick = this.controller;
        await ask();

        // The pick has already ended: the command was cancelled out from under the
        // question, or a click finished the point while it was up. Either way there is
        // no prompt left waiting to be re-asked, and restarting would bring a finished
        // command back to life.
        if (pick?.result !== undefined) return;

        await this.restart();
    }

    /**
     * `RECTANG Specify other corner point:` - answered as two lengths along the
     * workplane's axes, which is why the crosshair's boxes are X and Y here rather
     * than the distance and angle a point pick gets: the answer typed at the prompt
     * is `10,6`, and the boxes hold the same two numbers.
     */
    private readonly nextSnapData = (): SnapLengthAtPlaneData => {
        const { point, view } = this.stepDatas[0];
        return {
            point: () => point!,
            preview: this.previewRect,
            plane: (tmp: XYZ | undefined) => this.findPlane(view, point!, tmp),
            validator: this.handleValid,
            dynamicInputMode: "cartesian",
            // With the boxes up they are already showing these two numbers, in the
            // fields that can be typed into - a tip repeating them beside the
            // crosshair is the same reading twice, in the place where there is least
            // room for it.
            prompt: (snaped: SnapResult) => {
                if (Config.instance.enableDynamicInput) return undefined;
                const data = this.rectDataFromTemp(snaped.point!);
                return `${data.dx.toFixed(2)}, ${data.dy.toFixed(2)}`;
            },
        };
    };

    private readonly handleValid = (end: XYZ) => {
        const data = this.rectDataFromTemp(end);
        return data !== undefined && !MathUtils.anyEqualZero(data.dx, data.dy);
    };

    protected previewRect = (end: XYZ | undefined) => {
        if (end === undefined) return [this.meshPoint(this.stepDatas[0].point!)];
        const { plane, dx, dy } = this.rectDataFromTemp(end);

        return [
            this.meshPoint(this.stepDatas[0].point!),
            this.meshPoint(end),
            this.previewOutline(plane, dx, dy),
        ];
    };

    /**
     * The outline as it will actually be drawn. A subclass that treats its corners builds
     * the shape itself rather than letting the preview call the factory's plain rect,
     * which would rubber-band square corners onto a rectangle about to be placed rounded.
     */
    protected previewOutline(plane: Plane, dx: number, dy: number) {
        return this.meshCreatedShape("rect", plane, dx, dy);
    }

    protected rectDataFromTemp(tmp: XYZ): RectData {
        const { view, point } = this.stepDatas[0];
        const plane = view.workplane.translateTo(point!);
        return getReactData(plane, point!, tmp);
    }

    protected rectDataFromTwoSteps() {
        let rect: RectData;
        if (this.stepDatas[1].plane) {
            rect = getReactData(this.stepDatas[1].plane, this.stepDatas[0].point!, this.stepDatas[1].point!);
        } else {
            rect = this.rectDataFromTemp(this.stepDatas[1].point!);
        }
        return rect;
    }
}

@command({
    key: "create.rect",
    icon: "icon-rect",
})
export class Rect extends RectCommandBase {
    @property("option.rect.centerRect")
    public get centerRect() {
        return this.getPrivateValue("centerRect", false);
    }
    public set centerRect(value: boolean) {
        this.setProperty("centerRect", value);
    }

    /**
     * Which treatment the corners get - the panel's form of the prompt's
     * `[Chamfer/Fillet]`, asked the same way round.
     *
     * The prompt asks which first and how much second, because "how much" has no meaning
     * until the first is answered. The panel follows: this dropdown, then a single size
     * field that appears once it is set to something (see `cornerSize`'s dependencies).
     * Two always-visible number boxes asked the second question twice and the first not
     * at all, which is not the same conversation the command line is having.
     */
    @property("option.rect.cornerMode", {
        combobox: Combobox.from([
            "option.rect.cornerMode.none",
            "option.rect.cornerMode.fillet",
            "option.rect.cornerMode.chamfer",
        ]),
        // The same letters cornerOptions offers at the prompt.
        comboboxKeys: ["", "F", "C"],
    })
    public get cornerMode(): CornerMode {
        return this.getPrivateValue("cornerMode", "option.rect.cornerMode.none" as CornerMode);
    }
    public set cornerMode(value: CornerMode) {
        this.setProperty("cornerMode", value, () => {
            // Turning corners off is what zeroes the size - the shape has to follow the
            // dropdown, or the panel would say None over a rectangle drawn rounded.
            if (value === "option.rect.cornerMode.none") {
                this.setProperty("cornerSize", 0);
            } else if (this.cornerSize <= 0) {
                // Switching a treatment on with nothing set yet would draw square
                // corners and look like the dropdown had not worked. AutoCAD asks for
                // the distance at this point; the panel offers its last one instead.
                this.setProperty("cornerSize", this.lastCornerSize);
            }
            PubSub.default.pub("refreshStepPrompt");
        });
    }

    /**
     * How much of each corner the treatment takes - a radius for a fillet, the setback
     * for a chamfer. One field rather than two, because only one can apply at a time and
     * the dropdown above already says which.
     */
    @property("rect.cornerSize", {
        type: "length",
        // Either treatment, not both - a corner is one or the other, and the size means
        // the same thing to each.
        dependencies: [
            {
                property: "cornerMode",
                value: ["option.rect.cornerMode.fillet", "option.rect.cornerMode.chamfer"],
            },
        ],
    })
    public get cornerSize() {
        return this.getPrivateValue("cornerSize", 0);
    }
    public set cornerSize(value: number) {
        const size = Math.max(0, value);
        // Remembered so that flipping the dropdown off and on again comes back to the
        // size that was set, the way AutoCAD remembers its own.
        if (size > 0) this.lastCornerSize = size;
        this.setProperty("cornerSize", size);
    }

    private lastCornerSize = 0;

    /** The fillet radius the node is built with - zero unless Fillet is the mode. */
    private get cornerRadius() {
        return this.cornerMode === "option.rect.cornerMode.fillet" ? this.cornerSize : 0;
    }

    /** The chamfer setback the node is built with - zero unless Chamfer is the mode. */
    private get chamferDistance() {
        return this.cornerMode === "option.rect.cornerMode.chamfer" ? this.cornerSize : 0;
    }

    /**
     * `RECTANG Specify first corner point or [Chamfer/Fillet]:` - both always offered,
     * whatever is currently set, because this is where a user finds out they exist. An
     * option that only appears once the setting is on can never be the way it gets
     * turned on.
     */
    protected override cornerOptions(): StepOption[] {
        return [
            {
                key: "C",
                name: "prompt.optionName.chamfer",
                display: "prompt.option.chamfer",
                onSelect: () => {
                    void this.askThenRestart(() =>
                        this.askCornerSize("option.rect.cornerMode.chamfer", "prompt.rect.chamferDistance"),
                    );
                },
            },
            {
                key: "F",
                name: "prompt.optionName.fillet",
                display: "prompt.option.fillet",
                onSelect: () => {
                    void this.askThenRestart(() =>
                        this.askCornerSize("option.rect.cornerMode.fillet", "prompt.rect.filletRadius"),
                    );
                },
            },
        ];
    }

    /**
     * `Specify fillet radius for rectangles <10.00>:` - Enter alone keeps what is
     * remembered, and zero is how square corners come back.
     *
     * Sets the same two properties the panel's dropdown and size field set, so the two
     * surfaces are one setting seen twice: answer at the prompt and the dropdown has
     * moved to Fillet when you look up.
     */
    private async askCornerSize(mode: CornerMode, statusTip: I18nKeys): Promise<void> {
        // A controller of its own rather than the command's: this is asked from inside a
        // live pick, and `this.controller` is that pick's. Replacing it disposes the
        // listeners pickAsync is waiting on, which strands the pick - the canvas keeps
        // the crosshair and answers nothing, not even Escape. Cancelling the pick - the
        // panel's X, or another command starting - closes this question with it.
        const controller = new AsyncController();
        this.controller?.onCancelled(() => controller.cancel());

        const remembered =
            this.cornerMode === mode && this.cornerSize > 0 ? this.cornerSize : this.lastCornerSize;

        const size = await promptForValue<number>({
            controller,
            statusTip,
            defaultAnswer: UnitSetup.formatLength(remembered),
            parse: (text) => parseSetback(text, remembered),
        });
        if (size === undefined) return;

        // Zero is the answer that means square corners, so it turns the treatment off
        // rather than leaving the dropdown naming one that measures nothing.
        this.cornerMode = size > 0 ? mode : "option.rect.cornerMode.none";
        this.cornerSize = size;
    }

    /** Previews through RectNode, so the corners rubber-band the way they will be drawn. */
    protected override previewOutline(plane: Plane, dx: number, dy: number) {
        if (this.cornerRadius <= 0 && this.chamferDistance <= 0) {
            return super.previewOutline(plane, dx, dy);
        }

        const node = new RectNode({
            document: this.document,
            plane,
            dx,
            dy,
            cornerRadius: this.cornerRadius,
            chamferDistance: this.chamferDistance,
        });
        return this.meshShape(node.generateShape());
    }

    protected override rectDataFromTwoSteps() {
        const rect = super.rectDataFromTwoSteps();
        this.changeRectCenter(rect);
        return rect;
    }

    protected override rectDataFromTemp(tmp: XYZ): RectData {
        const rect = super.rectDataFromTemp(tmp);
        this.changeRectCenter(rect);
        return rect;
    }

    private changeRectCenter(rect: RectData) {
        if (!this.centerRect) return;

        // A corner aimed at with the mouse - or dialled into the crosshair's boxes,
        // which measure that same offset - is half the rectangle, because the other
        // half is drawn back through the centre. Text typed at the prompt is not: it
        // is the size being asked for, `10,6` meaning a rectangle 10 by 6.
        if (this.stepDatas.at(1)?.type !== "input") {
            rect.dx *= 2;
            rect.dy *= 2;
        }

        const { origin, xvec, yvec, normal } = rect.plane;
        rect.plane = new Plane({
            origin: origin.sub(xvec.multiply(rect.dx * 0.5)).sub(yvec.multiply(rect.dy * 0.5)),
            xvec,
            normal,
        });
    }

    protected override geometryNode(): GeometryNode {
        const { plane, dx, dy } = this.rectDataFromTwoSteps();
        return new RectNode({
            document: this.document,
            plane,
            dx,
            dy,
            cornerRadius: this.cornerRadius,
            chamferDistance: this.chamferDistance,
        });
    }
}
