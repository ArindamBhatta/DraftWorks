import {
    AsyncController,
    command,
    I18n,
    type I18nKeys,
    type ICurve,
    type IEdge,
    type IFace,
    type IShape,
    type ITrimmedCurve,
    Precision,
    PubSub,
    promptForValue,
    property,
    Result,
    type StepOption,
    UnitSetup,
    type XYZ,
} from "@draftworks/core";
import {
    angleMethodSetbacks,
    type ChamferMethod,
    type ChamferSetbacks,
    chamferCuts,
    cornerAngleBetween,
} from "./chamferGeometry";
import { EdgeCornerCommand } from "./edgeCornerCommand";
import { crossingParameters, straightDirection, supportCurve } from "./fillet";

/**
 * The straight curve an edge lies on and the direction it runs, or undefined when the
 * edge is not straight.
 *
 * Straightness is measured rather than asked about, so an offset of a line counts - see
 * straightDirection. A line drawn with OFFSET is an ordinary thing to chamfer.
 */
function supportLine(edge: IEdge): { curve: ICurve; direction: XYZ } | undefined {
    const curve = supportCurve(edge.curve);
    const direction = straightDirection(curve, edge.curve.firstParameter(), edge.curve.lastParameter());
    return direction ? { curve, direction } : undefined;
}

/**
 * A chamfer whose two setbacks differ, built here rather than in the kernel.
 *
 * chamferEdge2d steps back the same distance along both lines, which is the only
 * chamfer it can make. The rest is the same construction with two numbers instead of
 * one: find where the support lines cross, step back along each by its own setback, cut
 * the edges there and join the two cut points.
 *
 * The three edges come back in wire order - first, chamfer, second - which is what
 * EdgeCornerCommand splices back into the wire.
 */
function unequalChamfer(edge1: IEdge, edge2: IEdge, setbacks: ChamferSetbacks): Result<IEdge[]> {
    const line1 = supportLine(edge1);
    const line2 = supportLine(edge2);
    if (!line1 || !line2) {
        return Result.err(I18n.translate("error.fillet.zeroRadiusNeedsLines"));
    }

    const crossing = crossingParameters(
        line1.curve.value(0),
        line1.direction,
        line2.curve.value(0),
        line2.direction,
    );
    if (crossing === undefined) {
        return Result.err(I18n.translate("error.fillet.noCorner"));
    }

    // Each cut steps back towards the side the edge actually occupies, which its own
    // midpoint parameter names - the same rule the kernel uses.
    const mid = (span: ITrimmedCurve) => (span.firstParameter() + span.lastParameter()) / 2;
    const cuts = chamferCuts(crossing.param1, mid(edge1.curve), crossing.param2, mid(edge2.curve), setbacks);

    const piece1 = trimToCut(line1.curve, edge1.curve, cuts.cut1);
    const piece2 = trimToCut(line2.curve, edge2.curve, cuts.cut2);
    const chamferEdge = shapeFactory.line(line1.curve.value(cuts.cut1), line2.curve.value(cuts.cut2));
    if (!chamferEdge.isOk) return chamferEdge.parse();

    return Result.ok([piece1, chamferEdge.value, piece2]);
}

/** What an edge becomes once its corner end is cut back to `cut`. */
function trimToCut(line: ICurve, span: ITrimmedCurve, cut: number): IEdge {
    const first = span.firstParameter();
    const last = span.lastParameter();
    // Keep the side of the cut the edge's own body is on.
    const farEnd = cut - first >= last - cut ? first : last;
    const trimmed = line.trim(Math.min(cut, farEnd), Math.max(cut, farEnd));
    const edge = shapeFactory.edge(trimmed);
    trimmed.dispose();
    return edge;
}

@command({
    key: "modify.chamfer",
    icon: "icon-chamfer",
})
export class ChamferCommand extends EdgeCornerCommand {
    /**
     * The setback along the first line picked. Named `length` rather than `distance1`
     * because it was the command's only measurement before the second one existed, and
     * renaming a persisted property would lose every drawing's remembered value.
     */
    @property("common.length")
    get length() {
        return this.getPrivateValue("length", 10);
    }

    set length(value: number) {
        this.setProperty("length", value);
    }

    /**
     * The setback along the second line. Equal to the first by default, which is the
     * chamfer most corners want and the only one the kernel could make before.
     */
    @property("common.length")
    get secondLength() {
        return this.getPrivateValue("secondLength", 10);
    }

    set secondLength(value: number) {
        this.setProperty("secondLength", value);
    }

    /** The angle the chamfer leaves the first line at, when the method is Angle. */
    @property("common.angle")
    get angle() {
        return this.getPrivateValue("angle", 45);
    }

    set angle(value: number) {
        this.setProperty("angle", value);
    }

    /** Which pair of numbers defines the chamfer - AutoCAD's mEthod. */
    @property("option.command.chamferMethod.distance")
    get method(): ChamferMethod {
        return this.getPrivateValue("method", "distance");
    }

    set method(value: ChamferMethod) {
        this.setProperty("method", value);
    }

    /**
     * `Select first line or [Polyline/Distance/Angle/Trim/mEthod]:`
     *
     * AutoCAD's list in AutoCAD's order, less Multiple and Undo - those two change how
     * many corners the command visits across repeated picks, which this command's step
     * sequence has no room for yet. Better absent than present and inert.
     *
     * The capital in each word is the letter typed to choose it. `mEthod` takes E
     * because AutoCAD gives M to Multiple, and keeping the letters where a draftsman
     * expects them matters more than tidiness here.
     */
    protected override selectionOptions(): StepOption[] {
        return [
            this.polylineOption(),
            {
                key: "D",
                name: "prompt.optionName.distance",
                display: "prompt.option.distance",
                onSelect: () => {
                    void this.askDistances();
                },
            },
            {
                key: "A",
                name: "prompt.optionName.angle",
                display: "prompt.option.angle",
                onSelect: () => {
                    void this.askAngle();
                },
            },
            this.trimOption(),
            {
                key: "E",
                name: "prompt.optionName.method",
                display: "prompt.option.method",
                onSelect: () => {
                    void this.askMethod();
                },
            },
        ];
    }

    /**
     * Distance asks for both setbacks, the second defaulting to the first - so a chamfer
     * with equal sides is two numbers typed and an Enter, not two numbers typed twice.
     */
    private async askDistances() {
        const first = await this.askLength("prompt.chamfer.firstDistance", this.length);
        if (first === undefined) return this.backToSelection();

        this.length = first;
        const second = await this.askLength("prompt.chamfer.secondDistance", first);
        if (second !== undefined) this.secondLength = second;

        // Answering Distance is how AutoCAD switches to it, without a trip through mEthod.
        this.method = "distance";
        this.backToSelection();
    }

    /** Angle asks for the length along the first line, then the angle off it. */
    private async askAngle() {
        const distance = await this.askLength("prompt.chamfer.angleDistance", this.length);
        if (distance === undefined) return this.backToSelection();
        this.length = distance;

        const controller = new AsyncController();
        this.disposeStack.add(controller);
        const angle = await promptForValue<number>({
            controller,
            statusTip: "prompt.chamfer.angle",
            defaultAnswer: `${this.angle}`,
            parse: (text) => {
                const parsed = Number.parseFloat(text);
                // A chamfer has to leave the first line and still reach the second, so
                // it turns somewhere strictly inside a half turn.
                if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 180) {
                    return Result.err<I18nKeys>("error.input.invalidNumber");
                }
                return Result.ok(parsed);
            },
        });

        if (angle !== undefined) this.angle = angle;
        this.method = "angle";
        this.backToSelection();
    }

    /** `Enter trim method [Distance/Angle]` - which pair of numbers is believed. */
    private async askMethod() {
        const controller = new AsyncController();
        this.disposeStack.add(controller);

        const method = await promptForValue<ChamferMethod>({
            controller,
            statusTip: "prompt.chamfer.method",
            optionsOnly: true,
            choices: [
                { key: "D", name: "prompt.optionName.distance" },
                { key: "A", name: "prompt.optionName.angle" },
            ],
            defaultAnswer: I18n.translate(
                this.method === "distance"
                    ? "option.command.chamferMethod.distance"
                    : "option.command.chamferMethod.angle",
            ),
            parse: (text) => {
                const key = text.trim().toUpperCase();
                if (key === "D") return Result.ok<ChamferMethod>("distance");
                if (key === "A") return Result.ok<ChamferMethod>("angle");
                return Result.err<I18nKeys>("error.input.unsupportedInputs");
            },
        });

        if (method !== undefined) this.method = method;
        this.backToSelection();
    }

    /** One length sub-prompt, with the remembered value as the `<...>` Enter takes. */
    private async askLength(statusTip: I18nKeys, current: number): Promise<number | undefined> {
        const controller = new AsyncController();
        this.disposeStack.add(controller);

        return promptForValue<number>({
            controller,
            statusTip,
            defaultAnswer: UnitSetup.formatLength(current),
            parse: (text) => {
                const parsed = UnitSetup.tryParseLength(text);
                // Zero is a real answer here as it is for FILLET: it closes the corner
                // without cutting anything off.
                if (parsed === undefined || Number.isNaN(parsed) || parsed < 0) {
                    return Result.err<I18nKeys>("error.input.invalidNumber");
                }
                return Result.ok(parsed);
            },
        });
    }

    /** The selection prompt is what the user is looking at again - so it republishes. */
    private backToSelection() {
        PubSub.default.pub("refreshStepPrompt");
    }

    protected override applyToBody(shape: IShape, edgeIndexes: number[]): Result<IShape> {
        // 3D chamfers go through the kernel, which takes one distance - so the setback
        // along the first line is the one it gets.
        return shapeFactory.chamfer(shape, edgeIndexes, this.length);
    }

    protected override applyToFace(face: IFace, edge1: IEdge, edge2: IEdge): Result<IShape> {
        return shapeFactory.chamfer2d(face, edge1, edge2, this.length);
    }

    protected override applyToEdgePair(edge1: IEdge, edge2: IEdge): Result<IEdge[]> {
        const setbacks = this.setbacksFor(edge1, edge2);
        if (!setbacks.isOk) return setbacks.parse();

        const pieces = this.cutCorner(edge1, edge2, setbacks.value);
        if (!pieces.isOk || this.trimMode === "trim") return pieces;

        // No trim: the chamfer is laid across the corner and the two lines are left
        // whole. The middle piece is the chamfer; the outer two are the trimmed lines,
        // which is exactly what this mode asks not to have - so the originals are
        // handed back in their place, and the caller replaces each edge with itself.
        return Result.ok([edge1, pieces.value[1], edge2]);
    }

    /** The three edges the corner becomes: trimmed line, chamfer, trimmed line. */
    private cutCorner(edge1: IEdge, edge2: IEdge, setbacks: ChamferSetbacks): Result<IEdge[]> {
        // An equal chamfer is what the kernel already does, so it keeps doing it - the
        // two paths agree there, and this one stays the exception rather than the rule.
        if (Math.abs(setbacks.first - setbacks.second) < Precision.Distance) {
            return shapeFactory.chamferEdge2d(edge1, edge2, setbacks.first);
        }
        return unequalChamfer(edge1, edge2, setbacks);
    }

    /**
     * The two setbacks this run asks for, which is where mEthod is actually consulted:
     * Distance states them outright, Angle derives the second from the corner.
     */
    private setbacksFor(edge1: IEdge, edge2: IEdge): Result<ChamferSetbacks> {
        if (this.method === "distance") {
            return Result.ok({ first: this.length, second: this.secondLength });
        }

        const line1 = supportLine(edge1);
        const line2 = supportLine(edge2);
        if (!line1 || !line2) {
            return Result.err(I18n.translate("error.fillet.zeroRadiusNeedsLines"));
        }

        const setbacks = angleMethodSetbacks(
            this.length,
            this.angle,
            cornerAngleBetween(line1.direction, line2.direction),
        );
        return setbacks ? Result.ok(setbacks) : Result.err(I18n.translate("error.chamfer.angleDoesNotReach"));
    }
}
