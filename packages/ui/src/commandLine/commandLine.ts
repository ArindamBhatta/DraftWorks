import {
    type CommandAliasMatch,
    type CommandKeys,
    CommandPrefix,
    CommandStore,
    findCommandByAlias,
    findCommandSuggestions,
    I18n,
    type I18nKeys,
    type ICommand,
    Localize,
    PubSub,
    type Result,
    type StepOption,
} from "@draftworks/core";
import { createIcon, div, input, span } from "@draftworks/element";
import { stepOptionLabel } from "../stepOptionLabel";
import { CommandHistory } from "./commandHistory";
import style from "./commandLine.module.css";

/** How far Up-arrow can walk back through what was typed. */
const HISTORY_LIMIT = 50;

/**
 * A prompt waiting for something to be typed at it - see PubSub's `showInput`.
 *
 * `handler` is the running command's own parser: it answers whether the text meant
 * anything, and takes the prompt forward when it did.
 */
interface PromptInput {
    handler: (text: string) => Result<string, I18nKeys>;
    onCancelled?: () => void;
}

/**
 * AutoCAD's command line: the one live line where the conversation happens.
 *
 * It carries the running command's name, its prompt, its bracketed options and the box
 * you type into, in that order and on that one line - `FILLET Select first object or
 * [Radius/Trim/Multiple]:` - because that is one question being asked, and a question
 * split across two widgets is two things to look at instead of one. Before this it was
 * exactly that: the prompt and its options lived in the status bar, the typing box lived
 * here, and anything actually typed at a running command went to a third box floating at
 * the crosshair.
 *
 * What was said a moment ago is not here. It goes to CommandHistory, which shows the last
 * few lines over the drawing and takes them away again - the line being answered is worth
 * a permanent strip of the window, the ones already answered are not.
 *
 * Typed input now lands here instead of at the crosshair. The command line takes focus
 * only when a running command asks for text (`showInput`) and gives it straight back once
 * the answer is in, because between those moments the keyboard belongs to the view - that
 * is what carries Escape, Enter and the option keys to the running command. See
 * HotkeyService.canHandleKey, which stops forwarding the moment a text box holds focus.
 *
 * The crosshair keeps its distance and angle boxes: a number typed during a pick is a
 * dimension, and a dimension belongs next to the thing being dimensioned.
 */
export class CommandLine extends HTMLElement {
    private readonly textbox: HTMLInputElement;
    private readonly commandName: HTMLElement;
    private readonly tip: HTMLElement;
    private readonly options: HTMLElement;
    private readonly suggestionList: HTMLElement;

    private suggestions: CommandAliasMatch[] = [];
    private activeIndex = -1;
    private readonly history: string[] = [];
    private historyIndex = -1;
    private commandRunning = false;
    private promptInput: PromptInput | undefined;

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
            onfocus: this.handleFocus,
        });
        // Opts this box into HotkeyService's modifier shortcuts - see canHandleKey
        // there. Without it, Ctrl+S and Delete would be dead while it holds focus,
        // which is nearly always.
        this.textbox.dataset["chiliHotkeys"] = "true";

        this.commandName = span({ className: style.commandName });
        this.tip = span({ className: style.tip });
        this.options = div({ className: style.options });
        this.suggestionList = div({ className: style.suggestions, style: "display: none;" });

        this.setIdlePrompt();
        this.append(
            this.suggestionList,
            div(
                { className: style.live },
                span({ className: style.chevron, textContent: "›" }),
                this.commandName,
                this.tip,
                this.options,
                this.textbox,
            ),
        );
    }

    connectedCallback() {
        PubSub.default.sub("openCommandContext", this.handleCommandOpened);
        PubSub.default.sub("closeCommandContext", this.handleCommandClosed);
        PubSub.default.sub("statusBarTip", this.showTip);
        PubSub.default.sub("clearStatusBarTip", this.clearTip);
        PubSub.default.sub("showStepOptions", this.showStepOptions);
        PubSub.default.sub("clearStepOptions", this.clearStepOptions);
        PubSub.default.sub("showInput", this.showPromptInput);
        PubSub.default.sub("clearInput", this.clearPromptInput);
        window.addEventListener("keydown", this.handleGlobalKeyDown);
        setTimeout(() => this.focusInput());
    }

    disconnectedCallback() {
        PubSub.default.remove("openCommandContext", this.handleCommandOpened);
        PubSub.default.remove("closeCommandContext", this.handleCommandClosed);
        PubSub.default.remove("statusBarTip", this.showTip);
        PubSub.default.remove("clearStatusBarTip", this.clearTip);
        PubSub.default.remove("showStepOptions", this.showStepOptions);
        PubSub.default.remove("clearStepOptions", this.clearStepOptions);
        PubSub.default.remove("showInput", this.showPromptInput);
        PubSub.default.remove("clearInput", this.clearPromptInput);
        window.removeEventListener("keydown", this.handleGlobalKeyDown);
    }

    // ------------------------------------------------------------ the live line

    private readonly handleCommandOpened = (command: ICommand) => {
        this.commandRunning = true;
        this.hideSuggestions();
        const data = CommandStore.getComandData(command);
        if (data) this.commandName.textContent = commandTitle(data.key);
        // The running command owns the keyboard from here, until it asks for text.
        if (document.activeElement === this.textbox) this.textbox.blur();
    };

    private readonly handleCommandClosed = () => {
        this.commandRunning = false;
        this.promptInput = undefined;
        this.commandName.textContent = "";
        this.clearStepOptions();
        this.setIdlePrompt();
        setTimeout(() => this.focusInput());
    };

    private readonly showTip = (tip: I18nKeys) => {
        I18n.set(this.tip, "textContent", tip);
    };

    private readonly clearTip = () => {
        this.setIdlePrompt();
    };

    /** With nothing running, the line asks the only question there is: which command. */
    private setIdlePrompt() {
        I18n.set(this.tip, "textContent", "prompt.commandLine");
    }

    /**
     * `or [Close/Undo]:` - AutoCAD's bracketed alternatives, each one clickable.
     *
     * Clicking an option does exactly what typing its letter does, because both run the
     * same StepOption.onSelect (see core/src/snap/snap.ts): one pipeline, two ways in.
     * Only the words are clickable and only they are coloured, so what is on offer and
     * what is punctuation stay told apart at a glance.
     */
    private readonly showStepOptions = (options: StepOption[]) => {
        if (options.length === 0) {
            this.clearStepOptions();
            return;
        }

        const parts: (HTMLElement | Text)[] = [
            span({ className: style.optionsText, textContent: new Localize("prompt.or") }),
            span({ className: style.optionsBracket, textContent: "[" }),
        ];
        options.forEach((option, index) => {
            if (index > 0) {
                parts.push(span({ className: style.optionsBracket, textContent: "/" }));
            }
            parts.push(
                span(
                    {
                        className: style.option,
                        title: I18n.translate(option.display),
                        // The pick is still live behind this click - keep it that way.
                        onclick: (e: MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            option.onSelect();
                        },
                    },
                    ...optionLabel(option),
                ),
            );
        });
        parts.push(span({ className: style.optionsBracket, textContent: "]:" }));

        this.options.replaceChildren(...parts);
    };

    private readonly clearStepOptions = () => {
        this.options.replaceChildren();
    };

    // ------------------------------------------------------------ typed answers

    /**
     * A running command is asking for text. The box takes it here rather than at the
     * crosshair, seeded with the keystroke that started the typing so that the first
     * character is not swallowed.
     */
    private readonly showPromptInput = (
        text: string,
        handler: (text: string) => Result<string, I18nKeys>,
        onCancelled?: () => void,
    ) => {
        if (this.promptInput) return;

        this.promptInput = { handler, onCancelled };
        this.textbox.value = text;
        // Focus once the keystroke that got us here has finished being delivered.
        setTimeout(() => {
            this.textbox.focus();
            this.textbox.setSelectionRange(text.length, text.length);
        });
    };

    /** The answer is in, or the prompt has gone. Hand the keyboard back to the view. */
    private readonly clearPromptInput = () => {
        if (!this.promptInput) return;

        this.promptInput = undefined;
        this.emptyBox();
    };

    private emptyBox() {
        this.textbox.value = "";
        this.textbox.blur();
    }

    /**
     * Enter at a running command's prompt. An answer the command rejects is left in the
     * box with the reason in the transcript, which is AutoCAD re-asking rather than
     * throwing away what was typed.
     */
    private submitPromptInput(prompt: PromptInput) {
        const text = this.textbox.value.trim();
        // The box is handed back before the answer is acted on, because acting on it can
        // ask the next question: choosing RECTANG's Chamfer at the first prompt goes
        // straight on to "Specify chamfer distance", and showPromptInput ignores a
        // prompt that arrives while another is still armed - so that question would be
        // asked with nowhere to type the answer, and the command would wait for one for
        // ever.
        this.promptInput = undefined;
        this.emptyBox();

        const result = prompt.handler(text);
        if (result.isOk) {
            CommandHistory.push(text, "command");
            return;
        }

        CommandHistory.push(I18n.translate(result.error), "error");
        // Rejected, and nothing else has claimed the box in the meantime: put the
        // question back with what was typed still in it, ready to be corrected.
        if (!this.promptInput) {
            this.promptInput = prompt;
            this.textbox.value = text;
            this.textbox.focus();
            this.textbox.select();
        }
    }

    // ------------------------------------------------------------ keyboard

    private focusInput() {
        if (this.commandRunning || this.isModalOpen()) return;
        this.textbox.focus();
    }

    /**
     * The box is not for typing at while a command is running and has asked for nothing:
     * the keys belong to the view then, and a box holding focus is exactly what stops
     * them getting there - see HotkeyService.canHandleKey. Clicking into it would
     * otherwise silently kill Escape.
     */
    private readonly handleFocus = () => {
        if (this.commandRunning && !this.promptInput) this.textbox.blur();
    };

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
        // A running command's prompt takes an answer, not a command name.
        if (this.promptInput) return;

        this.suggestions = findCommandSuggestions(this.textbox.value);
        this.activeIndex = this.suggestions.length > 0 ? 0 : -1;
        this.renderSuggestions();
    };

    private readonly handleKeyDown = (e: KeyboardEvent) => {
        const prompt = this.promptInput;
        // Space submits as well as Enter, as it does in AutoCAD. Safe because no alias
        // contains one - but not while a running command is taking text, where a space
        // can be part of the answer.
        if (e.key === "Enter" || (e.key === " " && !prompt)) {
            e.preventDefault();
            e.stopPropagation();
            if (prompt) this.submitPromptInput(prompt);
            else this.submit();
            return;
        }

        switch (e.key) {
            case "Tab":
                if (!prompt && this.activeIndex >= 0) {
                    e.preventDefault();
                    this.textbox.value = this.suggestions[this.activeIndex].alias;
                    this.handleInput();
                }
                return;
            case "Escape":
                e.preventDefault();
                e.stopPropagation();
                if (prompt) {
                    this.clearPromptInput();
                    prompt.onCancelled?.();
                } else {
                    this.clear();
                }
                return;
            case "ArrowDown":
                if (prompt) return;
                e.preventDefault();
                this.move(1);
                return;
            case "ArrowUp":
                if (prompt) return;
                e.preventDefault();
                this.move(-1);
                return;
        }
        // Everything else is ordinary typing; stop it reaching the hotkey service, which
        // would otherwise accumulate it into a chord.
        e.stopPropagation();
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
            CommandHistory.push(I18n.translate("prompt.commandLine.unknown{0}", text), "error");
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

    // ------------------------------------------------------------ suggestions

    /**
     * The autocomplete list, each row led by the command's own ribbon icon.
     *
     * The icon is what makes the list scannable: the alias is two letters and the name is
     * a word, but the icon is the same picture the command wears on the ribbon, so a
     * half-remembered command can be recognised rather than read.
     */
    private renderSuggestions() {
        if (this.suggestions.length === 0) {
            this.hideSuggestions();
            return;
        }

        const typed = this.textbox.value.trim().length;
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
                    suggestionIcon(match.command),
                    span(
                        { className: style.alias },
                        // What has been typed so far, picked out of the alias it matched.
                        span({ className: style.aliasTyped, textContent: match.alias.slice(0, typed) }),
                        document.createTextNode(match.alias.slice(typed)),
                    ),
                    span({ className: style.name, textContent: commandTitle(match.command) }),
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

/** `FILLET` - the command's own name, as AutoCAD heads its prompt with it. */
function commandTitle(command: CommandKeys): string {
    return I18n.translate(`${CommandPrefix}${command}` as I18nKeys).toUpperCase();
}

/** The command's ribbon icon, or a blank of the same size when it has none. */
function suggestionIcon(command: CommandKeys): Element {
    const icon = CommandStore.getComandData(command)?.icon;
    const element = icon ? createIcon(icon) : span({});
    element.classList.add(style.suggestionIcon);
    return element;
}

/** `Close`, `Undo`, `mOde` - see stepOptionLabel, which the panel draws from too. */
function optionLabel(option: StepOption): (HTMLElement | Text)[] {
    return stepOptionLabel(option, style.optionHot);
}

customElements.define("chili-command-line", CommandLine);
