import {
    command,
    Dimensions,
    type GeometryNode,
    type IStep,
    type PointSnapData,
    PointStep,
    Precision,
    property,
    type StepOption,
    Transaction,
    type XYZ,
} from "@draftworks/core";
import { LineNode } from "../../bodys";
import { CreateCommand } from "../createCommand";

/**
 * AutoCAD's LINE. Each pass of the command draws one segment and then starts the
 * next from the end of the last, so a "run" is the chain of segments drawn before
 * the user backs out - which is what Close and Undo both operate on:
 *
 *     Specify next point or [Close/Undo]:
 *
 * Close joins the run back to where it started and finishes; Undo takes back the
 * last segment and puts the cursor where it began. Neither is offered before it
 * means anything - Undo needs a segment to take back, Close needs two, since
 * closing a single segment would just redraw it backwards.
 */
@command({
    key: "create.line",
    icon: "icon-line",
})
export class Line extends CreateCommand {
    /** Where the current run began - Close draws back to here. */
    #runStart: XYZ | undefined;
    /** The segments of the current run, newest last, so Undo can pop one. */
    readonly #runNodes: LineNode[] = [];

    @property("option.command.isConnected")
    get isContinue() {
        return this.getPrivateValue("isContinue", true);
    }
    set isContinue(value: boolean) {
        this.setProperty("isContinue", value);
    }

    protected override geometryNode(): GeometryNode {
        const node = new LineNode({
            document: this.document,
            start: this.stepDatas[0].point!,
            end: this.stepDatas[1].point!,
        });
        this.#runStart ??= this.stepDatas[0].point!;
        this.#runNodes.push(node);
        return node;
    }

    protected override executeMainTask(): void {
        super.executeMainTask();
        this.repeatOperation = true;
    }

    getSteps(): IStep[] {
        const firstStep = new PointStep("prompt.line.firstPoint", this.getFirstPointData);
        const secondStep = new PointStep("prompt.line.nextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    protected override resetStepDatas() {
        // Guarded because Undo restarts the command mid-pick, when only the start
        // point has been collected and there is no second point to carry forward.
        if (this.isContinue && this.stepDatas.length > 1) {
            this.stepDatas[0] = this.stepDatas[1];
            this.stepDatas.length = 1;
        } else if (!this.isContinue) {
            this.stepDatas.length = 0;
            this.#endRun();
        }
    }

    private readonly getFirstPointData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        // A fresh first point starts a new run, so nothing is left over from the last.
        beforeExecute: () => this.#endRun(),
    });

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimensions.D1D2D3,
            options: this.#runOptions,
            validator: (point: XYZ) => {
                return this.stepDatas[0].point!.distanceTo(point) > Precision.Distance;
            },
            preview: this.linePreview,
        };
    };

    /** `[Close/Undo]`, each offered only once it has something to act on. */
    readonly #runOptions = (): StepOption[] => {
        const options: StepOption[] = [];
        if (this.#runNodes.length >= 2 && this.#canCloseRun()) {
            options.push({
                key: "C",
                name: "prompt.optionName.close",
                display: "prompt.option.close",
                onSelect: this.#closeRun,
            });
        }
        if (this.#runNodes.length >= 1) {
            options.push({
                key: "U",
                name: "prompt.optionName.undo",
                display: "prompt.option.undo",
                onSelect: this.#undoSegment,
            });
        }
        return options;
    };

    #canCloseRun() {
        const here = this.stepDatas[0]?.point;
        return here !== undefined && this.#runStart !== undefined
            ? here.distanceTo(this.#runStart) > Precision.Distance
            : false;
    }

    /**
     * Draws the segment back to the run's first point and ends the command - the run
     * is a closed figure, so there is nothing left to continue from.
     */
    readonly #closeRun = () => {
        const from = this.stepDatas[0]?.point;
        const to = this.#runStart;
        if (!from || !to) return;

        Transaction.execute(this.document, "close line run", () => {
            this.document.modelManager.addNode(
                new LineNode({ document: this.document, start: from, end: to }),
            );
            this.document.visual.update();
        });

        this.#endRun();
        this.cancel();
    };

    /**
     * Takes back the last segment and reopens the pick from where that segment
     * began, so the next point replaces it. Undoing the only segment of a run leaves
     * nothing to draw from, so the command starts over from a fresh first point.
     */
    readonly #undoSegment = () => {
        const node = this.#runNodes.pop();
        if (!node) return;

        const resumeAt = node.start;
        Transaction.execute(this.document, "undo line segment", () => {
            node.parent?.remove(node);
            this.document.visual.update();
        });

        if (this.#runNodes.length === 0) {
            this.#runStart = undefined;
            this.stepDatas.length = 0;
        } else {
            this.stepDatas.length = 1;
            this.stepDatas[0] = { ...this.stepDatas[0], point: resumeAt };
        }
        this.restart();
    };

    #endRun() {
        this.#runStart = undefined;
        this.#runNodes.length = 0;
    }

    private readonly linePreview = (point: XYZ | undefined) => {
        if (!point) {
            return [this.meshPoint(this.stepDatas[0].point!)];
        }
        return [this.meshPoint(this.stepDatas[0].point!), this.meshLine(this.stepDatas[0].point!, point)];
    };
}
