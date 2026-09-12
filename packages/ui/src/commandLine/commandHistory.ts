import { type CommandKeys, CommandPrefix, I18n, type I18nKeys, PubSub } from "@draftworks/core";
import { div } from "@draftworks/element";
import style from "./commandHistory.module.css";

/** What a line is, which is all that decides how it is coloured. */
export type HistoryKind = "command" | "prompt" | "error";

/** How many lines can be on screen at once. A fifth pushes the oldest off the top. */
const MAX_VISIBLE = 4;

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
    }

    disconnectedCallback() {
        if (CommandHistory.current === this) CommandHistory.current = undefined;
        PubSub.default.remove("executeCommand", this.handleCommandStarted);
        PubSub.default.remove("statusBarTip", this.handleTip);
    }

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
        while (this.childElementCount > MAX_VISIBLE) {
            this.firstElementChild?.remove();
        }

        setTimeout(() => {
            line.classList.add(style.leaving);
            setTimeout(() => line.remove(), FADE);
        }, LIFETIME);
    }
}

function lineStyle(kind: HistoryKind): string {
    if (kind === "error") return style.error;
    return kind === "command" ? style.command : style.prompt;
}

customElements.define("chili-command-history", CommandHistory);
