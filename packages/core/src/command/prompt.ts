import type { AsyncController } from "../foundation/asyncController";
import { PubSub } from "../foundation/pubsub";
import { Result } from "../foundation/result";
import type { I18nKeys } from "../i18n";

export interface FlyoutPromptOptions<T> {
    /**
     * Cancelling this controller closes the prompt and resolves undefined, so a command
     * that is waiting here still answers its Cancel button and gets out of the way when
     * another command is started.
     */
    controller: AsyncController;
    /** Status-bar line. A plain key: the status bar translates without arguments. */
    statusTip: I18nKeys;
    /**
     * The floating prompt above the box, already translated - it normally carries the
     * remembered default, AutoCAD's `<...>`, which needs formatting the key cannot do.
     */
    message: string;
    /** Prefills the box. Defaults to empty, so Enter alone means "take the default". */
    initialText?: string;
    parse: (text: string) => Result<T, I18nKeys>;
}

/**
 * Asks for one typed value the AutoCAD way: a prompt line and an input box in the
 * viewport flyout, Enter to accept, Escape to back out. Resolves undefined when the
 * user backs out, by Escape or by anything that cancels the command underneath it.
 *
 * This is the blocking counterpart to the snap handlers' use of `showInput`, which
 * offer the box alongside a live pick and carry on if it is dismissed.
 */
export function promptForValue<T>(options: FlyoutPromptOptions<T>): Promise<T | undefined> {
    PubSub.default.pub("statusBarTip", options.statusTip);
    PubSub.default.pub("showFloatTip", { level: "info", msg: options.message });

    return new Promise<T | undefined>((resolve) => {
        let settled = false;
        // Whichever ending arrives first wins: the box is shown by every open view's
        // flyout, and the command can also be cancelled from under it, so more than one
        // of these can fire.
        const finish = (value: T | undefined) => {
            if (settled) return;
            settled = true;
            PubSub.default.pub("clearInput");
            PubSub.default.pub("clearFloatTip");
            PubSub.default.pub("clearStatusBarTip");
            resolve(value);
        };

        options.controller.onCancelled(() => finish(undefined));
        PubSub.default.pub(
            "showInput",
            options.initialText ?? "",
            (text: string) => {
                const parsed = options.parse(text);
                if (!parsed.isOk) return Result.err<I18nKeys>(parsed.error);

                finish(parsed.value);
                return Result.ok(text);
            },
            () => finish(undefined),
        );
    });
}
