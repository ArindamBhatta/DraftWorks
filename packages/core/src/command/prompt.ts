import type { AsyncController } from "../foundation/asyncController";
import { PubSub } from "../foundation/pubsub";
import { Result } from "../foundation/result";
import type { I18nKeys } from "../i18n";

/**
 * One of the answers a prompt names between its brackets - the `Quick` of
 * `[Quick/Standard]`.
 *
 * It is only the two words: what you type and what it is called. What the answer *does*
 * is already in the prompt's own `parse`, and a choice that carried its own action could
 * disagree with it - which would mean clicking `Quick` and typing `Q` doing two different
 * things.
 */
export interface PromptChoice {
    /** What you type to pick it, e.g. "Q". Must be something `parse` accepts. */
    key: string;
    /** The word it goes by, e.g. "Quick" - see StepOption.name. */
    name: I18nKeys;
}

export interface FlyoutPromptOptions<T> {
    /**
     * Cancelling this controller closes the prompt and resolves undefined, so a command
     * that is waiting here still answers its Cancel button and gets out of the way when
     * another command is started.
     */
    controller: AsyncController;
    /** The prompt line. A plain key: the command line translates without arguments. */
    statusTip: I18nKeys;
    /**
     * The answers this prompt names, shown as `[Quick/Standard]` on the command line -
     * clickable there, and offered as you type so a half-remembered option can be
     * recognised rather than recalled. Leave it out for a prompt that takes a free value
     * and names nothing, like a text height.
     */
    choices?: PromptChoice[];
    /**
     * Whether `choices` are the whole question rather than an alternative to a free
     * value. Drops AutoCAD's "or": `Enter a trim mode option [Quick/Standard]` against
     * `Specify offset distance or [Through]`.
     */
    optionsOnly?: boolean;
    /**
     * The remembered answer, already formatted - AutoCAD's `<...>`, which is what Enter
     * alone takes. `parse` is what actually applies it; this only says so on screen.
     */
    defaultAnswer?: string;
    /** Prefills the box. Defaults to empty, so Enter alone means "take the default". */
    initialText?: string;
    parse: (text: string) => Result<T, I18nKeys>;
}

/**
 * Asks for one typed value the AutoCAD way: the question on the command line with its
 * options beside it, the answer typed on the same line, Enter to accept, Escape to back
 * out. Resolves undefined when the user backs out, by Escape or by anything that cancels
 * the command underneath it.
 *
 * This is the blocking counterpart to the snap handlers' use of `showInput`, which offer
 * the box alongside a live pick and carry on if it is dismissed.
 */
export function promptForValue<T>(options: FlyoutPromptOptions<T>): Promise<T | undefined> {
    PubSub.default.pub("statusBarTip", options.statusTip);

    return new Promise<T | undefined>((resolve) => {
        let settled = false;
        // Whichever ending arrives first wins: the command can be cancelled from under
        // the prompt as well as answered at it, so more than one of these can fire.
        const finish = (value: T | undefined) => {
            if (settled) return;
            settled = true;
            PubSub.default.pub("clearInput");
            PubSub.default.pub("clearStepOptions");
            PubSub.default.pub("clearStatusBarTip");
            resolve(value);
        };

        // The one way in, whether the text was typed or an option was clicked - see
        // PromptChoice on why a choice does not carry an action of its own.
        const submit = (text: string): Result<string, I18nKeys> => {
            const parsed = options.parse(text);
            if (!parsed.isOk) return Result.err<I18nKeys>(parsed.error);

            finish(parsed.value);
            return Result.ok(text);
        };

        options.controller.onCancelled(() => finish(undefined));

        PubSub.default.pub(
            "showStepOptions",
            (options.choices ?? []).map((choice) => ({
                key: choice.key,
                name: choice.name,
                display: choice.name,
                onSelect: () => submit(choice.key),
            })),
            { defaultAnswer: options.defaultAnswer, optionsOnly: options.optionsOnly },
        );
        PubSub.default.pub("showInput", options.initialText ?? "", submit, () => finish(undefined));
    });
}
