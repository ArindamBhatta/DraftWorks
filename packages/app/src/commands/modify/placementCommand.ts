import {
    AsyncController,
    Combobox,
    Dimensions,
    hideCommandProperty,
    I18n,
    type I18nKeys,
    type IStep,
    Matrix4,
    type PointSnapData,
    PointStep,
    promptForValue,
    property,
    Result,
    type ShapeMeshData,
    type StepOption,
    type XYZ,
} from "@draftworks/core";
import { TransformedCommand } from "./transformedCommand";

/** The two answers to "[Single/Multiple]", as the i18n keys that name them. */
export const PlacementModes = {
    single: "option.command.placementMode.single",
    multiple: "option.command.placementMode.multiple",
} as const satisfies Record<string, I18nKeys>;

/**
 * The prompt lines a placement command asks in its own words.
 *
 * The mOde pair is what decides whether the command offers Single/Multiple at all:
 * supply them and the option appears at the base-point prompt, leave them out and it
 * does not. MOVE leaves them out - one move is a move, and a MOVE that kept asking for
 * somewhere else to put the same objects would only be a slower way to drag them.
 */
export interface PlacementPrompts {
    basePoint: I18nKeys;
    secondPoint: I18nKeys;
    displacement: I18nKeys;
    /** "Enter a copy mode option" - the command line's own words for the question. */
    mode?: I18nKeys;
}

/**
 * The translation an answered MOVE/COPY stands for.
 *
 * `base` is undefined in Displacement mode, where the single point given is the shift
 * itself measured from the origin. `basePointIsShift` is Enter at the second-point
 * prompt, which says to read the base point that way instead - so a base point of
 * `10,0` and Enter shifts ten units along x, wherever the objects happen to sit.
 *
 * Exported for testing.
 */
export function placementShift(base: XYZ | undefined, point: XYZ, basePointIsShift = false): XYZ {
    if (base === undefined) return point;
    return basePointIsShift ? base : point.sub(base);
}

/**
 * Reads the answer to "[Single/Multiple]" the AutoCAD way: `S`/`Single`, `M`/`Multiple`
 * however capitalised, or an empty line for the remembered answer the prompt is
 * showing in its `<...>`. Anything else is rejected and the question asked again.
 *
 * Exported for testing.
 */
export function parsePlacementMode(text: string, remembered: I18nKeys): I18nKeys | undefined {
    const trimmed = text.trim();
    if (trimmed === "") return remembered;
    if (/^s(ingle)?$/i.test(trimmed)) return PlacementModes.single;
    if (/^m(ultiple)?$/i.test(trimmed)) return PlacementModes.multiple;
    return undefined;
}

/**
 * What MOVE and COPY have in common, which is nearly everything:
 *
 *     Select objects:
 *     Specify base point or [Displacement/mOde] <Displacement>:      (mOde: COPY only)
 *     Specify second point or <use first point as displacement>:
 *
 * The same three ways of answering, and Displacement on both. The one real difference
 * is whether the objects themselves travel or a duplicate does, which
 * TransformedCommand already expresses as `isClone` - so MOVE is this command with
 * cloning off and COPY is this command with cloning on, and neither offers a switch for
 * it. A MOVE that could leave the original behind is a COPY, and dressing that up as an
 * option on MOVE only hides the command that does the job.
 *
 * mOde is COPY's alone, as it is in AutoCAD: dropping a row of copies is one command's
 * worth of work, whereas the same objects can only be in one place, so a MOVE that kept
 * asking where next would just be a slow drag. A command opts in by naming the mOde
 * prompts - see PlacementPrompts.
 */
export abstract class PlacementCommand extends TransformedCommand {
    protected abstract get prompts(): PlacementPrompts;

    /**
     * Single or Multiple, remembered between invocations the way AutoCAD's COPYMODE
     * is. The dropdown and the prompt's `mOde` option are the same setting seen twice:
     * CommandContext.syncCombobox keeps the panel pointed at whatever the command now
     * says, so answering at the prompt moves the dropdown and the other way round.
     */
    @property("option.command.placementMode", {
        combobox: Combobox.from<I18nKeys>([PlacementModes.single, PlacementModes.multiple]),
    })
    get placementMode(): I18nKeys {
        return this.getPrivateValue("placementMode", this.defaultPlacementMode);
    }
    set placementMode(value: I18nKeys) {
        this.setProperty("placementMode", value);
    }

    /** MOVE finishes after one move; COPY keeps dropping copies, as in AutoCAD. */
    protected get defaultPlacementMode(): I18nKeys {
        return PlacementModes.single;
    }

    protected get isMultiple() {
        return this.placementMode === PlacementModes.multiple;
    }

    /** True once the user has answered the base-point prompt with `D`, or with Enter. */
    #displacementMode = false;
    /** True once Enter at the second-point prompt has read the base point as the shift. */
    #basePointIsShift = false;
    /** Set by `O`, so the mode question is asked once this prompt has been torn down. */
    #askMode = false;
    /** How many times the transform has been applied so far in this invocation. */
    #rounds = 0;

    override getSteps(): IStep[] {
        if (this.#displacementMode) {
            return [new PointStep(this.prompts.displacement, this.getDisplacementData, true)];
        }
        return [
            new PointStep(this.prompts.basePoint, this.getBasePointData, true),
            new PointStep(this.prompts.secondPoint, this.getSecondPointData, true),
        ];
    }

    /**
     * Deliberately keeps `#displacementMode` and `#askMode`: choosing either option
     * restarts the command to swap in a different question, and clearing the flag here
     * would undo the very choice that triggered the restart. Both are per-invocation
     * anyway, since a fresh command instance is built each time MOVE or COPY is run.
     */
    protected override onRestarting(): void {
        super.onRestarting();
        this.#rounds = 0;
        this.#basePointIsShift = false;
    }

    /**
     * MultiStepCommand runs its steps once; Multiple mode runs them until the user
     * stops, so the loop lives here. Object selection stays outside it - the objects
     * are chosen once and then placed as many times as asked.
     */
    protected override async executeAsync(): Promise<void> {
        if (this.#askMode) {
            this.#askMode = false;
            if (!(await this.askPlacementMode())) return;
        }
        if (!(await this.canExcute())) return;

        while (await this.executeSteps()) {
            this.executeMainTask();
            this.#rounds++;
            if (!this.beginNextRound()) return;
        }
    }

    /**
     * Sets up another round of a Multiple placement, or returns false to finish.
     *
     * Both ways of naming a shift as a vector - Displacement, and Enter reading the
     * base point as one - complete in a single round, as they do in AutoCAD. Nothing
     * was aimed at, so there is no "and now to here" to ask for.
     */
    private beginNextRound(): boolean {
        if (!this.isMultiple || this.#displacementMode || this.#basePointIsShift) return false;

        if (!this.isClone) {
            // The objects moved, so the base point travelled with them: the next pick
            // means "and now to here" rather than repeating the first move from the
            // spot the objects have already left. The preview has to be re-read from
            // where they are now for the same reason.
            const previous = this.stepDatas[0];
            const landed = previous.point!.add(this.shiftOf(this.stepDatas.at(-1)!.point!));
            this.stepDatas[0] = { ...previous, point: landed };
            this.refreshPositions();
        }
        // Cloning leaves the originals - and so the base point - exactly where they
        // were, which is what makes every further pick drop another copy at its own
        // offset from the same base.
        this.stepDatas.length = 1;
        return true;
    }

    // -------------------------------------------------------------- the base point

    private readonly getBasePointData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        options: this.#baseOptions,
        // AutoCAD's `<Displacement>`: Enter here takes that default. It names no point
        // because entering the mode restarts the command, and the prompt this Enter
        // ends is the one being replaced.
        onEnter: () => {
            this.enterDisplacementMode();
            return undefined;
        },
    });

    readonly #baseOptions = (): StepOption[] => {
        const options: StepOption[] = [
            {
                key: "D",
                name: "prompt.optionName.displacement",
                display: "prompt.option.displacement",
                onSelect: this.enterDisplacementMode,
            },
        ];
        // Only for the commands that have a mOde question to ask - see PlacementPrompts.
        if (this.prompts.mode) {
            options.push({
                key: "O",
                name: "prompt.optionName.mode",
                display: "prompt.option.mode",
                onSelect: () => {
                    // The question needs the input box, and this prompt still holds it,
                    // so it is asked on the way back in rather than from here.
                    this.#askMode = true;
                    this.restart();
                },
            });
        }
        return options;
    };

    private readonly enterDisplacementMode = () => {
        this.#displacementMode = true;
        this.restart();
    };

    // ------------------------------------------------------------ the second point

    private readonly getSecondPointData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2D3,
        preview: this.placementPreview,
        // AutoCAD's `<use first point as displacement>`, offered only the first time
        // through: in a Multiple run Enter is how you stop, so a later round has to let
        // it back out rather than placing one more.
        onEnter: () => {
            if (this.#rounds > 0) return undefined;
            this.#basePointIsShift = true;
            return this.stepDatas[0].point!;
        },
    });

    private readonly placementPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const base = this.stepDatas[0].point!;
        const marker = this.meshPoint(base);
        if (!point) return [marker];
        return [marker, this.transformPreview(point), this.getTempLineData(base, point)];
    };

    // ------------------------------------------------------------- Displacement

    private readonly getDisplacementData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        preview: (point: XYZ | undefined) => (point ? [this.transformPreview(point)] : []),
    });

    // -------------------------------------------------------------------- mOde

    /**
     * AutoCAD's "Enter a mode option [Single/Multiple]". Returns false when the user
     * backs out, which ends the command the way Escape at any other prompt does.
     */
    private async askPlacementMode(): Promise<boolean> {
        const { mode } = this.prompts;
        // Unreachable: only the `O` option sets the flag, and it is only offered when
        // this command has the question to ask.
        if (!mode) return true;

        this.controller = new AsyncController();
        const answer = await promptForValue({
            controller: this.controller,
            statusTip: mode,
            choices: [
                { key: "S", name: PlacementModes.single },
                { key: "M", name: PlacementModes.multiple },
            ],
            optionsOnly: true,
            defaultAnswer: I18n.translate(this.placementMode),
            parse: (text) => {
                const mode = parsePlacementMode(text, this.placementMode);
                return mode ? Result.ok(mode) : Result.err<I18nKeys>("error.placement.invalidMode");
            },
        });
        if (answer === undefined) return false;

        this.placementMode = answer;
        return true;
    }

    // ------------------------------------------------------------------ the result

    private shiftOf(point: XYZ): XYZ {
        const base = this.#displacementMode ? undefined : this.stepDatas[0].point!;
        return placementShift(base, point, this.#basePointIsShift);
    }

    protected override transfrom(point: XYZ): Matrix4 {
        const { x, y, z } = this.shiftOf(point);
        return Matrix4.fromTranslation(x, y, z);
    }
}

// Cloning is not MOVE's or COPY's to offer - it is the difference between them, and a
// MOVE with a Clone checkbox is just a second, worse COPY.
hideCommandProperty(PlacementCommand.prototype, ["isClone"]);
