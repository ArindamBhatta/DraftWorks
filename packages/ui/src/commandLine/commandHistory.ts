import { type CommandKeys, CommandPrefix, I18n, type I18nKeys, PubSub } from "@draftworks/core";
import { div } from "@draftworks/element";
import style from "./commandHistory.module.css";

/** What a line is, which is all that decides how it is coloured. */
export type HistoryKind = "command" | "prompt" | "error";

/** How many lines can be on screen at once. A fifth pushes the oldest off the top. */
const MAX_VISIBLE = 4;

/**
 * How many are kept while the stack is pinned (F2). Larger because a pinned stack is
 * being read back through rather than glanced at, but still bounded - this floats over
 * the drawing, and a transcript that grows without limit ends up covering it.
 */
const MAX_VISIBLE_PINNED = 20;

/** How long a line stays before it fades. Long enough to read, short enough to forget. */
const LIFETIME = 3000;

const FADE = 200;

/**
 * What the command line has just said, shown over the drawing and then gone.
 *
 * A command's back-and-forth is worth seeing while it is happening - `Command: LINE`,
 * `Specify first point`, `c` - and worth nothing a minute later. A scrolling transcript
 * pane treats those as the same thing and charges a strip of the drawing for both; this
 * shows the last few lines stacked over the canvas and takes each one away three seconds
 * after it arrives, so the drawing is never permanently smaller for the sake of history
 * nobody goes back to read.
 *
 * The stack never takes the pointer - see `pointer-events` in its stylesheet. It sits
 * over the drawing, so anything else would mean clicking through a message that is about
 * to disappear anyway.
 */
export class CommandHistory extends HTMLElement {
    /** The mounted stack. There is one editor, so there is one of these. */
    private static current: CommandHistory | undefined;

    /** The last line shown, so a republished prompt is not stacked on top of itself. */
    private static lastLine = "";

    /** The command last started, so `special.last` can be named rather than echoed. */
    private static lastCommand: CommandKeys | undefined;

    /**
     * AutoCAD's F2 text window, as much of one as a floating stack can be: while pinned,
     * lines stop expiring and more of them are kept, so what was said a minute ago can be
     * read back. Unpinning lets the backlog go rather than timing each line out from
     * whenever it happened to arrive - the drafter has just said they are done with it.
     */
    private pinned = false;

    /** Timers for the lines now on screen, so pinning can cancel the ones in flight. */
    private readonly timers = new Map<HTMLElement, number>();

    /**
     * Shows a line, unless it is the one already showing.
     *
     * A step republishes its prompt whenever anything it depends on changes - see
     * PubSub's `refreshStepPrompt` - and a stack that took each republish would fill with
     * repeats of the question that is already on screen.
     */
    static push(text: string, kind: HistoryKind) {
        if (text === "" || text === CommandHistory.lastLine) return;

        CommandHistory.lastLine = text;
        CommandHistory.current?.show(text, kind);
    }

    constructor() {
        super();
        this.className = style.stack;
    }

    connectedCallback() {
        CommandHistory.current = this;
        PubSub.default.sub("executeCommand", this.handleCommandStarted);
        PubSub.default.sub("statusBarTip", this.handleTip);
        PubSub.default.sub("toggleCommandHistory", this.togglePinned);
    }

    disconnectedCallback() {
        if (CommandHistory.current === this) CommandHistory.current = undefined;
        PubSub.default.remove("executeCommand", this.handleCommandStarted);
        PubSub.default.remove("statusBarTip", this.handleTip);
        PubSub.default.remove("toggleCommandHistory", this.togglePinned);
    }

    private readonly togglePinned = () => {
        this.pinned = !this.pinned;
        this.classList.toggle(style.pinned, this.pinned);

        if (this.pinned) {
            // Lines already counting down would otherwise vanish out of a stack the user
            // has just asked to hold still.
            this.timers.forEach((id) => clearTimeout(id));
            this.timers.clear();
            return;
        }

        // Unpinned: drop what had accumulated and go back to showing only the recent few.
        this.innerHTML = "";
        this.timers.clear();
    };

    /** `Command: LINE`, the way AutoCAD heads every command it runs. */
    private readonly handleCommandStarted = (command: CommandKeys) => {
        // "special.last" is Enter on an empty line: it is the previous command about to
        // run again, and naming it by its placeholder would say nothing.
        const resolved = command === "special.last" ? CommandHistory.lastCommand : command;
        if (!resolved) return;

        CommandHistory.lastCommand = resolved;
        const name = I18n.translate(`${CommandPrefix}${resolved}` as I18nKeys).toUpperCase();
        CommandHistory.push(`${I18n.translate("prompt.commandLine")} ${name}`, "command");
    };

    private readonly handleTip = (tip: I18nKeys) => {
        CommandHistory.push(I18n.translate(tip), "prompt");
    };

    private show(text: string, kind: HistoryKind) {
        const line = div({ className: `${style.line} ${lineStyle(kind)}`, textContent: text });
        this.append(line);
        const limit = this.pinned ? MAX_VISIBLE_PINNED : MAX_VISIBLE;
        while (this.childElementCount > limit) {
            const oldest = this.firstElementChild as HTMLElement | null;
            if (!oldest) break;
            const timer = this.timers.get(oldest);
            if (timer !== undefined) clearTimeout(timer);
            this.timers.delete(oldest);
            oldest.remove();
        }

        // Pinned lines have no expiry at all - that is what pinning means. They go when
        // the stack is unpinned, or when enough newer lines push them past the limit.
        if (this.pinned) return;

        const timer = window.setTimeout(() => {
            this.timers.delete(line);
            line.classList.add(style.leaving);
            setTimeout(() => line.remove(), FADE);
        }, LIFETIME);
        this.timers.set(line, timer);
    }
}

function lineStyle(kind: HistoryKind): string {
    if (kind === "error") return style.error;
    return kind === "command" ? style.command : style.prompt;
}

customElements.define("chili-command-history", CommandHistory);
