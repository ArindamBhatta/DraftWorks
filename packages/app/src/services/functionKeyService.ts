import {
    Config,
    type DraftingAidKey,
    FunctionKeyToggles,
    I18n,
    type IApplication,
    type IService,
    Logger,
    PubSub,
} from "@draftworks/core";

/**
 * AutoCAD's function-key row: F3/F7/F8/F10/F11/F12 flip a drafting aid, F1 shows the
 * shortcut list and F2 pins the command history.
 *
 * Separate from HotkeyService because these are not commands. HotkeyService's job is to
 * turn a chord into a `CommandKeys` and publish `executeCommand`; a function key changes
 * a setting and the drawing carries on, with no command started, nothing pushed onto the
 * undo stack and no interruption to whatever is mid-pick. That last part is the whole
 * point of the row - pressing F8 halfway through a LINE is the normal way to use it - and
 * it works here because every snap reads Config on each mouse move rather than caching
 * what was set when the command began.
 *
 * See FunctionKeyToggles for which keys are bound and why the rest are not.
 */
export class FunctionKeyService implements IService {
    register(_app: IApplication): void {
        Logger.info(`${FunctionKeyService.name} registed`);
    }

    start(): void {
        // Capture, so the row keeps working while a text box has focus. A function key
        // types nothing, so there is no editing context it could be stealing from - and
        // the command line holds focus almost all the time, which would otherwise make
        // these dead exactly when a drafter reaches for them.
        window.addEventListener("keydown", this.handleKeyDown, true);
        Logger.info(`${FunctionKeyService.name} started`);
    }

    stop(): void {
        window.removeEventListener("keydown", this.handleKeyDown, true);
        Logger.info(`${FunctionKeyService.name} stoped`);
    }

    private readonly handleKeyDown = (e: KeyboardEvent) => {
        // A modifier makes it a different shortcut, not this one: Ctrl+F4 and Alt+F4 are
        // the browser's and the window manager's, and taking those would be worse than
        // not having the key at all.
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (!this.dispatch(e.key)) return;

        e.preventDefault();
        // Stops HotkeyService and the command line's own global handler seeing the key
        // as well, so nothing else can act on the same press.
        e.stopImmediatePropagation();
    };

    /** Runs whatever the key is bound to. False means "not ours", so leave the event alone. */
    private dispatch(key: string): boolean {
        if (key === "F1") {
            PubSub.default.pub("toggleShortcutPanel");
            return true;
        }
        if (key === "F2") {
            PubSub.default.pub("toggleCommandHistory");
            return true;
        }

        const toggle = FunctionKeyToggles.find((t) => t.key === key);
        if (!toggle) return false;

        this.toggleAid(toggle.property, toggle.label);
        return true;
    }

    private toggleAid(property: DraftingAidKey, label: Parameters<typeof I18n.translate>[0]) {
        const next = !Config.instance[property];
        Config.instance[property] = next;
        // `<Ortho on>`, the way AutoCAD confirms the key did something. Without it a
        // function key is silent unless the drafter happens to be looking at the status
        // bar, which is the one place they are not looking while drawing.
        PubSub.default.pub(
            "showToast",
            next ? "toast.mode.{0}On" : "toast.mode.{0}Off",
            I18n.translate(label),
        );
    }
}
