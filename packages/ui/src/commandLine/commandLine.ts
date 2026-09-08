import {
    type CommandAliasMatch,
    type CommandKeys,
    CommandPrefix,
    findCommandByAlias,
    findCommandSuggestions,
    I18n,
    type I18nKeys,
    PubSub,
} from "@chili3d/core";
import { div, input, label, span } from "@chili3d/element";
import style from "./commandLine.module.css";

const HISTORY_LIMIT = 50;

/**
 * AutoCAD's command line: type an alias, press Enter, the command runs. `L` draws a
 * line, `O` offsets, `DT` places text.
 *
 * It holds the keyboard whenever no command is running - start typing anywhere over the
 * drawing and the characters land here, which is what makes a command line feel like
 * one. While a command *is* running it deliberately gives focus up, because the running
 * command's snap handler needs the keys for its own typed input (coordinates, distances,
 * Escape to cancel).
 *
 * This is why the single-letter instant shortcuts are gone from DefaultShortcuts: a key
 * that fires a command the moment it is pressed and a command line you type words into
 * cannot both own the letter `L`. Every one of them survives here as an alias.
 */
export class CommandLine extends HTMLElement {
    private readonly textbox: HTMLInputElement;
    private readonly message: HTMLElement;
    private readonly suggestionList: HTMLElement;

    private suggestions: CommandAliasMatch[] = [];
    private activeIndex = -1;
    private readonly history: string[] = [];
    private historyIndex = -1;
    private commandRunning = false;

    constructor(className?: string) {
        super();
        this.className = className ? `${style.panel} ${className}` : style.panel;

        this.textbox = input({
            className: style.input,
            type: "text",
            spellcheck: false,
            autocomplete: "off",
            onkeydown: this.handleKeyDown,
            oninput: this.handleInput,
            onblur: this.hideSuggestions,
        });
        // Opts this box into HotkeyService's modifier shortcuts - see canHandleKey
        // there. Without it, Ctrl+S and Delete would be dead while it holds focus,
        // which is nearly always.
        this.textbox.dataset["chiliHotkeys"] = "true";

        this.message = span({ className: style.message });
        this.suggestionList = div({ className: style.suggestions, style: "display: none;" });

        this.append(
            this.suggestionList,
            label({ className: style.prompt, textContent: I18n.translate("prompt.commandLine") }),
            this.textbox,
            this.message,
        );
    }

    connectedCallback() {
        PubSub.default.sub("openCommandContext", this.handleCommandOpened);
        PubSub.default.sub("closeCommandContext", this.handleCommandClosed);
        window.addEventListener("keydown", this.handleGlobalKeyDown);
        setTimeout(() => this.focusInput());
    }

    disconnectedCallback() {
        PubSub.default.remove("openCommandContext", this.handleCommandOpened);
        PubSub.default.remove("closeCommandContext", this.handleCommandClosed);
        window.removeEventListener("keydown", this.handleGlobalKeyDown);
    }

    private readonly handleCommandOpened = () => {
        this.commandRunning = true;
        this.hideSuggestions();
        // The running command owns the keyboard from here.
        if (document.activeElement === this.textbox) this.textbox.blur();
    };

    private readonly handleCommandClosed = () => {
        this.commandRunning = false;
        this.setMessage("");
        setTimeout(() => this.focusInput());
    };

    private focusInput() {
        if (this.commandRunning || this.isModalOpen()) return;
        this.textbox.focus();
    }

    /** A modal dialog owns the keyboard while it is up. */
    private isModalOpen(): boolean {
        return document.querySelector("dialog[open]") !== null;
    }

    /**
     * Sends stray typing to the command line, the way AutoCAD does - you should not have
     * to click into it first. Only plain printable keys, and only when nothing else
     * wants them: no running command, no modal, and not while another field has focus.
     */
    private readonly handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (this.commandRunning || this.isModalOpen()) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key.length !== 1 || e.key === " ") return;

        const target = e.target as HTMLElement | null;
        if (!target || target === this.textbox) return;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

        // focus() alone will not deliver the keystroke that is already in flight.
        e.preventDefault();
        this.textbox.focus();
        this.textbox.value += e.key;
        this.handleInput();
    };

    private readonly handleInput = () => {
        this.setMessage("");
        this.suggestions = findCommandSuggestions(this.textbox.value);
        this.activeIndex = this.suggestions.length > 0 ? 0 : -1;
        this.renderSuggestions();
    };

    private readonly handleKeyDown = (e: KeyboardEvent) => {
        switch (e.key) {
            // Space submits as well as Enter, as it does in AutoCAD. Safe because no
            // alias contains one.
            case "Enter":
            case " ":
                e.preventDefault();
                e.stopPropagation();
                this.submit();
                return;
            case "Tab":
                if (this.activeIndex >= 0) {
                    e.preventDefault();
                    this.textbox.value = this.suggestions[this.activeIndex].alias;
                    this.handleInput();
                }
                return;
            case "Escape":
                e.preventDefault();
                e.stopPropagation();
                this.clear();
                return;
            case "ArrowDown":
                e.preventDefault();
                this.move(1);
                return;
            case "ArrowUp":
                e.preventDefault();
                this.move(-1);
                return;
            default:
                // Everything else is ordinary typing; stop it reaching the hotkey
                // service, which would otherwise accumulate it into a chord.
                e.stopPropagation();
        }
    };

    private move(delta: number) {
        if (this.suggestions.length > 0) {
            const count = this.suggestions.length;
            this.activeIndex = (this.activeIndex + delta + count) % count;
            this.renderSuggestions();
            return;
        }
        this.recallHistory(delta);
    }

    /** Up walks back through what was typed before, as in AutoCAD. */
    private recallHistory(delta: number) {
        if (this.history.length === 0) return;

        if (this.historyIndex === -1) {
            this.historyIndex = delta < 0 ? this.history.length - 1 : -1;
        } else {
            this.historyIndex = Math.min(this.history.length - 1, Math.max(0, this.historyIndex + delta));
        }
        if (this.historyIndex >= 0) this.textbox.value = this.history[this.historyIndex];
    }

    private submit() {
        const text = this.textbox.value.trim();
        this.hideSuggestions();

        // Enter on an empty line repeats the last command - AutoCAD's oldest habit.
        if (text === "") {
            this.run("special.last", "");
            return;
        }

        // What the suggestion list is showing wins, so Down-then-Enter picks it.
        const chosen = this.activeIndex >= 0 ? this.suggestions[this.activeIndex] : undefined;
        const command = chosen?.alias === text ? chosen.command : findCommandByAlias(text);
        if (!command) {
            this.setMessage(I18n.translate("prompt.commandLine.unknown{0}", text), true);
            this.textbox.select();
            return;
        }

        this.run(command, text);
    }

    private run(command: CommandKeys, typed: string) {
        if (typed !== "" && this.history.at(-1) !== typed) {
            this.history.push(typed);
            if (this.history.length > HISTORY_LIMIT) this.history.shift();
        }
        this.historyIndex = -1;
        this.textbox.value = "";
        this.suggestions = [];
        this.activeIndex = -1;
        PubSub.default.pub("executeCommand", command);
    }

    private clear() {
        if (this.textbox.value === "") {
            this.textbox.blur();
            return;
        }
        this.textbox.value = "";
        this.handleInput();
    }

    private setMessage(text: string, isError = false) {
        this.message.textContent = text;
        this.message.classList.toggle(style.error, isError);
    }

    private renderSuggestions() {
        if (this.suggestions.length === 0) {
            this.hideSuggestions();
            return;
        }

        this.suggestionList.replaceChildren(
            ...this.suggestions.map((match, index) =>
                div(
                    {
                        className:
                            index === this.activeIndex
                                ? `${style.suggestion} ${style.active}`
                                : style.suggestion,
                        // pointerdown, not click: the input blurs before click lands.
                        onpointerdown: (e: PointerEvent) => {
                            e.preventDefault();
                            this.run(match.command, match.alias);
                        },
                    },
                    span({ className: style.alias, textContent: match.alias }),
                    span({
                        className: style.name,
                        textContent: I18n.translate(commandDisplayKey(match.command)),
                    }),
                ),
            ),
        );
        this.suggestionList.style.display = "";
    }

    private readonly hideSuggestions = () => {
        this.suggestionList.style.display = "none";
        this.suggestionList.replaceChildren();
    };
}

function commandDisplayKey(command: CommandKeys): I18nKeys {
    return `${CommandPrefix}${command}` as I18nKeys;
}

customElements.define("chili-command-line", CommandLine);
