import {
    Combobox,
    type CommandKeys,
    Dimensions,
    type I18nKeys,
    type PointSnapData,
    PubSub,
    property,
    type StepOption,
} from "@draftworks/core";
import { CreateCommand } from "../createCommand";

export type ArcMode =
    | "option.command.arcMode.centerStartAngle"
    | "option.command.arcMode.twoPoint"
    | "option.command.arcMode.threePoint";

/** The command each method is drawn by. */
const ArcModeCommands: Record<ArcMode, CommandKeys> = {
    "option.command.arcMode.centerStartAngle": "create.arc",
    "option.command.arcMode.twoPoint": "create.arc2point",
    "option.command.arcMode.threePoint": "create.arc3point",
};

/** The letter the prompt takes for each method, as AutoCAD writes them. */
const ArcModeKeys: Record<ArcMode, string> = {
    "option.command.arcMode.centerStartAngle": "C",
    "option.command.arcMode.twoPoint": "2P",
    "option.command.arcMode.threePoint": "3P",
};

/** What each key means, for the option's tooltip. */
const ArcModeTips: Record<ArcMode, I18nKeys> = {
    "option.command.arcMode.centerStartAngle": "prompt.option.center",
    "option.command.arcMode.twoPoint": "prompt.option.twoPoint",
    "option.command.arcMode.threePoint": "prompt.option.threePoint",
};

const ArcModes: ArcMode[] = [
    "option.command.arcMode.centerStartAngle",
    "option.command.arcMode.twoPoint",
    "option.command.arcMode.threePoint",
];

/**
 * The method dropdown shared by the three arc commands.
 *
 * Circle keeps its methods as one command with a `mode` that restarts the step
 * sequence; arc's are three separate commands, because each builds its geometry a
 * different way. That difference should not be something the user can see, so this
 * base gives all three the same `mode` - switching it leaves the current command and
 * starts the one that owns the chosen method.
 *
 * The point is that the three ways in stay in step: the panel's dropdown, the prompt's
 * `[2P/3P]` and the ribbon's Arc flyout all set the same property and all show the same
 * current method. Before this, only the flyout could reach 2-point and 3-point, so a
 * user already inside ARC had no way across and no sign the other methods existed.
 */
export abstract class ArcModeCommand extends CreateCommand {
    /** The method this command draws - each subclass answers with its own. */
    protected abstract get ownMode(): ArcMode;

    @property("option.command.arcMode", {
        combobox: Combobox.from(ArcModes),
        comboboxKeys: ArcModes.map((m) => ArcModeKeys[m]),
    })
    get mode(): ArcMode {
        return this.getPrivateValue("mode", this.ownMode);
    }
    set mode(value: ArcMode) {
        this.setProperty("mode", value, () => this.switchMode(value));
    }

    /**
     * Hands off to the command that owns the chosen method. Cancelling first matters:
     * two create commands running at once would both be taking picks.
     */
    private switchMode(value: ArcMode) {
        if (value === this.ownMode) return;
        this.cancel();
        PubSub.default.pub("executeCommand", ArcModeCommands[value]);
    }

    /**
     * The other two methods, offered at the prompt the way Circle offers its own -
     * as bare keys, which is how AutoCAD writes `[2P/3P]`, with the meaning on hover.
     */
    protected readonly modeOptions = (): StepOption[] =>
        ArcModes.filter((mode) => mode !== this.ownMode).map((mode) => ({
            key: ArcModeKeys[mode],
            display: ArcModeTips[mode],
            onSelect: () => {
                this.mode = mode;
            },
        }));

    /**
     * First-step data carrying those options - `ARC Specify start point or [C/3P]:`.
     * Subclasses whose first step needs nothing else can use this as it is.
     */
    protected readonly getModeStartData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        options: this.modeOptions,
    });
}
