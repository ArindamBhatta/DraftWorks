import {
    AsyncController,
    Config,
    command,
    type I18nKeys,
    type IApplication,
    type ICommand,
    promptForValue,
    Result,
} from "@draftworks/core";

/**
 * AutoCAD's CURSORSIZE and PICKBOX, as typed commands. Both ask the same way AutoCAD's
 * system variables do: the current value is offered as the default in `<...>`, Enter alone
 * keeps it, a number changes it, Escape backs out. They are application commands - a
 * cursor setting is not tied to any one drawing - and both persist, so the size a drafter
 * settles on is there the next time they open the app.
 *
 * The value is clamped by the Config setter, not here, so typing an out-of-range number is
 * folded to the nearest allowed size rather than rejected: the prompt only has to reject
 * what is not a number at all.
 */
function parseSize(text: string): Result<number, I18nKeys> {
    const value = Number(text.trim());
    return Number.isFinite(value) ? Result.ok(value) : Result.err<I18nKeys>("error.settings.notANumber");
}

@command({
    key: "config.crosshairSize",
    icon: "icon-cog",
    isApplicationCommand: true,
})
export class CrosshairSizeCommand implements ICommand {
    async execute(_app: IApplication): Promise<void> {
        const controller = new AsyncController();
        const value = await promptForValue<number>({
            controller,
            statusTip: "prompt.settings.crosshairSize",
            defaultAnswer: String(Config.instance.crosshairSize),
            parse: parseSize,
        });
        if (value !== undefined) {
            Config.instance.crosshairSize = value;
            Config.instance.saveToStorage();
        }
    }
}

@command({
    key: "config.pickbox",
    icon: "icon-cog",
    isApplicationCommand: true,
})
export class PickboxSizeCommand implements ICommand {
    async execute(_app: IApplication): Promise<void> {
        const controller = new AsyncController();
        const value = await promptForValue<number>({
            controller,
            statusTip: "prompt.settings.pickbox",
            defaultAnswer: String(Config.instance.pickboxSize),
            parse: parseSize,
        });
        if (value !== undefined) {
            Config.instance.pickboxSize = value;
            Config.instance.saveToStorage();
        }
    }
}
