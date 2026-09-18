import {
    type AiQuestion,
    AiSetup,
    answersAsText,
    type ConversationTurn,
    type FreeformDrawing,
    route,
} from "@draftworks/ai";
import { type FolderNode, I18n, type IApplication, PubSub } from "@draftworks/core";
import { button, div, input, label, option, p, select, span, textarea } from "@draftworks/element";
import {
    DRAWING_MODE_INFO,
    DRAWING_MODES,
    type DrawingMode,
    defaultsOf,
    floorPlanGenerator,
    type Generator,
    GeneratorRegistry,
    isTechnicalMode,
    type ParamDef,
} from "@draftworks/generators";
import { AiChatStore, type StoredChats } from "./aiChatStore";
import { generatorContext } from "./aiContext";
import style from "./aiPanel.module.css";
import { renderPreview } from "./aiPreview";
import { insertDrawing } from "./aiRenderer";
import { promptAiSetup } from "./aiSetupDialog";

/** Everything this app knows how to draw. Adding a generator here is the whole wiring. */
export const registry = new GeneratorRegistry().register(floorPlanGenerator);

/**
 * One tab's worth of the panel.
 *
 * Each mode keeps its own history and its own folder because a drawing replaces the
 * previous one from the same tab - a follow-up is a revision. Sharing either across tabs
 * would make sketching a cup delete the pile cap, and would leave the model reading a
 * transcript about reinforcement while answering a question about a floor plan.
 */
interface ModeState {
    readonly transcript: HTMLElement;
    turns: ConversationTurn[];
    folder: FolderNode | undefined;
    greeted: boolean;
    /**
     * Every prompt sent from this tab, oldest first, in step with the `.entry` elements
     * carrying `data-prompt`. Editing prompt *n* truncates both this list and the
     * transcript to *n*, which is also how the model's `turns` get rewound - a revised
     * question must not arrive after the answer to the question it replaces.
     */
    prompts: string[];
}

/**
 * The input/output box: the draftsman describes a drawing, and it appears on the canvas.
 *
 * Every turn shows three things - what was asked, what was understood, and a preview of
 * what is about to be drawn. The middle one matters most: the model chooses which
 * drawing and fills in its parameters, so the read-back is where a misreading gets
 * caught, and the Adjust form beside it is how it gets corrected without re-typing the
 * sentence. That form is also the whole feature offline, with no key and no network.
 *
 * The tabs across the top are not a filter over one catalogue - each is a different
 * posture, decided in `@draftworks/ai`. The three technical ones ask before they draw; the
 * freehand one draws.
 */
export class AiPanel {
    readonly root: HTMLElement;
    readonly #input: HTMLTextAreaElement;
    readonly #draw: HTMLButtonElement;
    readonly #states = new Map<DrawingMode, ModeState>();
    readonly #tabs = new Map<DrawingMode, HTMLButtonElement>();
    readonly #store: AiChatStore;
    #active: DrawingMode = "architectural";
    #busy = false;
    /** The drawing whose history is loaded, so a save cannot land on a different one. */
    #documentId: string | undefined;

    constructor(readonly application: IApplication) {
        this.#store = new AiChatStore(application.storage);
        for (const mode of DRAWING_MODES) {
            this.#states.set(mode, {
                transcript: div({ className: style.transcript }),
                turns: [],
                folder: undefined,
                greeted: false,
                prompts: [],
            });
        }

        this.#input = textarea({
            className: style.input,
            // The panel lives inside the main window, which routes keystrokes to command
            // hotkeys; without this, typing a description would fire half the toolbar.
            onkeydown: (e) => {
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void this.#submit();
                }
            },
        });
        this.#draw = button({
            textContent: I18n.translate("ai.draw"),
            onclick: () => void this.#submit(),
        });

        const tabs = div(
            { className: style.tabs },
            ...DRAWING_MODES.map((mode) => {
                const tab = button({
                    className: style.tab,
                    textContent: DRAWING_MODE_INFO[mode].title,
                    onclick: () => this.#activate(mode, true),
                });
                this.#tabs.set(mode, tab);
                return tab;
            }),
        );

        this.root = div(
            { className: style.root },
            tabs,
            this.#state.transcript,
            div(
                { className: style.footer },
                this.#input,
                div(
                    { className: style.actions },
                    this.#draw,
                    button({
                        className: style.link,
                        textContent: I18n.translate("ai.clearChat"),
                        onclick: () => void this.#clear(),
                    }),
                    button({
                        className: style.link,
                        textContent: I18n.translate("ai.openSettings"),
                        onclick: () => void promptAiSetup(),
                    }),
                ),
            ),
        );

        this.#activate(this.#active);
        void this.#restore();
    }

    /**
     * Brings back the conversation this drawing was made with.
     *
     * Only the prompts come back, as plain text - see `aiChatStore`. They are laid out
     * before the greeting so a reopened panel reads top-to-bottom the way it was left,
     * and each one is still editable, so a reload is a fine place to revise from.
     */
    async #restore() {
        const id = this.application.activeView?.document?.id;
        if (!id) return;
        this.#documentId = id;

        const stored: StoredChats = await this.#store.read(id);
        for (const mode of DRAWING_MODES) {
            const chat = stored[mode];
            if (!chat?.prompts.length) continue;
            const state = this.#states.get(mode)!;
            state.turns = chat.turns;
            for (const prompt of chat.prompts) this.#appendPrompt(state, prompt);
        }
    }

    /** Saves every tab's history for the open drawing. Called after anything that changes it. */
    #persist() {
        const id = this.#documentId ?? this.application.activeView?.document?.id;
        if (!id) return;
        this.#documentId = id;

        const modes: StoredChats = {};
        for (const [mode, state] of this.#states) {
            if (state.prompts.length) modes[mode] = { prompts: [...state.prompts], turns: state.turns };
        }
        void this.#store.write(id, modes);
    }

    /** Empties the active tab, on screen, in the model's history, and on disk. */
    async #clear() {
        if (this.#busy) return;
        const state = this.#state;
        state.transcript.replaceChildren();
        state.prompts = [];
        state.turns = [];
        state.greeted = true;
        this.#greet();
        this.#persist();
    }

    get #state(): ModeState {
        return this.#states.get(this.#active)!;
    }

    /** Swaps the visible transcript. Each tab's history stays where the draftsman left it. */
    #activate(mode: DrawingMode, focus = false) {
        if (this.#busy) return;
        if (mode !== this.#active) {
            this.#state.transcript.replaceWith(this.#states.get(mode)!.transcript);
            this.#active = mode;
        }
        for (const [id, tab] of this.#tabs) tab.classList.toggle(style.activeTab, id === mode);

        // The placeholder doubles as the mode's shortest explanation of itself.
        this.#input.placeholder = DRAWING_MODE_INFO[mode].examples[0];
        if (!this.#state.greeted) {
            this.#state.greeted = true;
            this.#greet();
        }
        if (focus) this.#input.focus();
    }

    #greet() {
        const entry = div({ className: style.entry });
        if (!AiSetup.isConfigured) {
            entry.append(p({ className: style.note, textContent: I18n.translate("ai.needsKey") }));
        }
        this.#appendExamples(entry);

        const generator = registry.byMode(this.#active)[0];
        if (!AiSetup.isConfigured && generator) {
            entry.append(this.#form(generator, defaultsOf(generator)));
        }
        this.#push(entry);
    }

    /** The mode's own examples - the fastest way to show what this tab is for. */
    #appendExamples(entry: HTMLElement) {
        entry.append(span({ className: style.label, textContent: I18n.translate("ai.examples") }));
        const examples = div({ className: style.examples });
        for (const example of DRAWING_MODE_INFO[this.#active].examples) {
            examples.append(span({ textContent: example }));
        }
        entry.append(examples);
    }

    #push(node: HTMLElement) {
        const { transcript } = this.#state;
        transcript.append(node);
        transcript.scrollTop = transcript.scrollHeight;
    }

    /**
     * One prompt as it was said, with the pencil that reopens it.
     *
     * The entry is tagged `data-prompt` so `#rewind` can count prompts and cut the
     * transcript at one without holding a parallel array of nodes - the DOM is already
     * the list, and one source of truth for the order is enough.
     */
    #appendPrompt(state: ModeState, text: string) {
        const bubble = p({ className: style.request, textContent: text });
        const edit = button({
            className: style.edit,
            title: I18n.translate("ai.editPrompt"),
            textContent: "✎",
            onclick: () => this.#edit(entry, bubble),
        });
        const entry = div({ className: style.entry }, div({ className: style.requestRow }, edit, bubble));
        entry.setAttribute("data-prompt", "");

        const { transcript } = state;
        transcript.append(entry);
        transcript.scrollTop = transcript.scrollHeight;
    }

    /**
     * Swaps the bubble for a box holding the same words.
     *
     * Saving re-sends, which means dropping everything below: the answers under an edited
     * prompt were replies to what it used to say, and leaving them would put a drawing in
     * the transcript that nothing above it asks for. The model's history is rewound to the
     * same point for the same reason. Cancel restores the bubble untouched.
     */
    #edit(entry: HTMLElement, bubble: HTMLElement) {
        if (this.#busy || entry.querySelector("textarea")) return;
        const original = bubble.textContent ?? "";

        const box = textarea({
            className: style.editBox,
            value: original,
            onkeydown: (e) => {
                e.stopPropagation();
                if (e.key === "Escape") close();
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    save();
                }
            },
        });

        const editor = div({ className: style.editor }, box);
        const close = () => {
            editor.replaceWith(row);
        };
        const save = () => {
            const text = box.value.trim();
            if (!text) return;
            if (text === original) {
                close();
                return;
            }
            const index = this.#rewind(entry);
            if (index < 0) return;
            void this.#send(text);
        };

        editor.append(
            div(
                { className: style.actions },
                button({ textContent: I18n.translate("ai.save"), onclick: save }),
                button({
                    className: style.link,
                    textContent: I18n.translate("common.cancel"),
                    onclick: close,
                }),
            ),
        );

        const row = entry.firstElementChild as HTMLElement;
        row.replaceWith(editor);
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
    }

    /**
     * Cuts the active tab back to just before `entry`, and returns where that was.
     *
     * The model's transcript is trimmed to the turns that preceded that prompt, counted
     * by user turns rather than by position: a single prompt can leave a `call` turn
     * behind it, so the two lists do not advance in step.
     */
    #rewind(entry: HTMLElement): number {
        const state = this.#state;
        const entries = [...state.transcript.querySelectorAll<HTMLElement>("[data-prompt]")];
        const index = entries.indexOf(entry);
        if (index < 0) return -1;

        // Everything from the edited prompt down, the prompt itself included - #send
        // re-appends it with the new words.
        let node: Element | null = entry;
        while (node) {
            const next: Element | null = node.nextElementSibling;
            node.remove();
            node = next;
        }

        state.prompts.length = index;
        state.turns.length = turnsBefore(state.turns, index);
        return index;
    }

    #say(className: string, text: string): HTMLElement {
        const entry = div({ className: style.entry }, p({ className, textContent: text }));
        this.#push(entry);
        return entry;
    }

    async #submit() {
        if (this.#busy) return;
        const text = this.#input.value.trim();
        if (!text) {
            this.#say(style.error, I18n.translate("ai.emptyRequest"));
            return;
        }
        this.#input.value = "";
        await this.#send(text);
    }

    /** One turn, from whatever said it - the text box, or a round of answered questions. */
    async #send(text: string) {
        if (this.#busy) return;
        if (!this.application.activeView?.document) {
            this.#say(style.error, I18n.translate("ai.noDocument"));
            return;
        }

        this.#state.prompts.push(text);
        this.#appendPrompt(this.#state, text);
        this.#persist();

        if (!AiSetup.isConfigured) {
            const entry = this.#say(style.note, I18n.translate("ai.needsKey"));
            const generator = registry.byMode(this.#active)[0];
            if (generator) entry.append(this.#form(generator, defaultsOf(generator)));
            return;
        }

        // Busy locks the tabs too, so an answer cannot arrive into a transcript the
        // draftsman has since switched away from.
        this.#setBusy(true);
        const pending = this.#say(style.note, I18n.translate("ai.thinking"));
        this.#state.turns.push({ role: "user", text });

        try {
            const { result, turn } = await route({
                registry,
                mode: this.#active,
                turns: this.#state.turns,
                settings: AiSetup.settings,
            });
            if (turn) this.#state.turns.push(turn);
            pending.remove();

            if (result.kind === "error") {
                this.#say(style.error, result.message);
                return;
            }
            if (result.kind === "cannotDraw") {
                const entry = this.#say(style.note, result.reason);
                this.#appendExamples(entry);
                return;
            }
            if (result.kind === "questions") {
                this.#ask(result.questions);
                return;
            }
            if (result.kind === "freeform") {
                this.#drawFreeform(result.drawing);
                return;
            }

            const generator = registry.get(result.generatorId);
            if (!generator) {
                this.#say(style.error, `Unknown drawing "${result.generatorId}".`);
                return;
            }
            this.#draw2(generator, result.params);
        } catch (error) {
            pending.remove();
            this.#say(style.error, error instanceof Error ? error.message : String(error));
        } finally {
            this.#setBusy(false);
            // After the reply, so what is stored is a transcript the model can be handed
            // back - a user turn saved without the call it provoked would replay as an
            // unanswered question.
            this.#persist();
        }
    }

    /**
     * The questions, as one round of chips.
     *
     * Everything stays enabled after a pick, so a changed mind costs a second click
     * rather than a second round-trip, and nothing is compulsory - a draftsman who does
     * not care can send it as it stands. The text box below is still live throughout, so
     * an answer none of the chips offers can simply be typed.
     */
    #ask(questions: AiQuestion[]) {
        const entry = div({ className: style.entry });
        entry.append(span({ className: style.label, textContent: I18n.translate("ai.questions") }));

        const answers = new Map<string, string>();
        for (const { question, options } of questions) {
            const chips = div({ className: style.chips });
            for (const value of options) {
                const chip = button({
                    className: style.chip,
                    textContent: value,
                    onclick: () => {
                        answers.set(question, value);
                        for (const other of chips.children) other.classList.remove(style.chosen);
                        chip.classList.add(style.chosen);
                    },
                });
                chips.append(chip);
            }
            entry.append(p({ className: style.question, textContent: question }), chips);
        }

        const send = button({
            textContent: I18n.translate("ai.draw"),
            onclick: () => {
                send.remove();
                const answered = [...answers].map(([question, answer]) => ({ question, answer }));
                void this.#send(
                    answered.length ? answersAsText(answered) : I18n.translate("ai.skipQuestions"),
                );
            },
        });
        entry.append(div({ className: style.actions }, send));
        this.#push(entry);
    }

    /** Previews and inserts geometry the model produced itself. */
    #drawFreeform(drawing: FreeformDrawing) {
        const view = this.application.activeView;
        if (!view?.document) {
            this.#say(style.error, I18n.translate("ai.noDocument"));
            return;
        }

        const entry = div({ className: style.entry });
        entry.append(span({ className: style.label, textContent: I18n.translate("ai.understood") }));
        entry.append(p({ className: style.summary, textContent: drawing.title }));
        entry.append(div({ className: style.preview }, renderPreview(drawing.items, drawing.layers)));
        entry.append(
            p({
                className: style.note,
                textContent: I18n.translate(
                    "ai.drawnOn",
                    drawing.layers.map((layer) => layer.name).join(", "),
                ),
            }),
        );
        // Said plainly rather than buried: a generator's output is checked arithmetic and
        // this is not, and the difference matters most to whoever trusts it least. In the
        // freehand mode it would be noise - nothing there is dimensioned or built from.
        if (isTechnicalMode(this.#active)) {
            entry.append(p({ className: style.note, textContent: I18n.translate("ai.freeformNote") }));
        }
        this.#push(entry);

        const state = this.#state;
        state.folder = insertDrawing(view.document, drawing, drawing.items, view.workplane, state.folder);
        PubSub.default.pub("showToast", "toast.ai.drawn");
    }

    /** Coerces, generates, previews and inserts - the path both entry routes converge on. */
    #draw2(generator: Generator<unknown>, raw: Record<string, unknown>) {
        const view = this.application.activeView;
        if (!view?.document) {
            this.#say(style.error, I18n.translate("ai.noDocument"));
            return;
        }

        const ctx = generatorContext();
        const spec = generator.coerce(raw, ctx);
        if (!spec.isOk) {
            const entry = this.#say(style.error, spec.error.message);
            entry.append(this.#form(generator, raw));
            return;
        }

        const items = generator.generate(spec.value, ctx);
        if (!items.isOk) {
            const entry = this.#say(style.error, this.#explain(items.error, ctx));
            entry.append(this.#form(generator, raw));
            return;
        }

        const entry = div({ className: style.entry });
        entry.append(span({ className: style.label, textContent: I18n.translate("ai.understood") }));
        entry.append(p({ className: style.summary, textContent: generator.summarize(spec.value, ctx) }));
        entry.append(div({ className: style.preview }, renderPreview(items.value, generator.layers)));
        entry.append(p({ className: style.note, textContent: I18n.translate("ai.drawn") }));

        const adjust = button({
            className: style.link,
            textContent: I18n.translate("ai.adjust"),
            onclick: () => {
                adjust.remove();
                entry.append(this.#form(generator, raw));
            },
        });
        entry.append(div({ className: style.actions }, adjust));
        this.#push(entry);

        // Replacing the previous drawing rather than stacking a second one: a follow-up
        // like "make it 3BHK" is a revision, and it stays a single undo step.
        const state = this.#state;
        state.folder = insertDrawing(view.document, generator, items.value, view.workplane, state.folder);
        PubSub.default.pub("showToast", "toast.ai.drawn");
    }

    /** Turns a generator's refusal into something a draftsman can act on. */
    #explain(
        error: { code: string; message: string; detail?: Record<string, number | string> },
        ctx: ReturnType<typeof generatorContext>,
    ): string {
        const detail = error.detail;
        if (error.code !== "tooSmall" || !detail) return error.message;
        const read = (name: string) => Number(detail[name]);
        const size = (w: string, h: string) => `${ctx.format(read(w))} x ${ctx.format(read(h))}`;
        return [
            error.message,
            `The buildable area is ${size("availableWidthMm", "availableDepthMm")},`,
            `and this plan needs at least ${size("neededWidthMm", "neededDepthMm")}.`,
        ].join(" ");
    }

    /**
     * The parameters, editable. Reached by the Adjust link, by any failure, and by every
     * turn when there is no API key - the generators are usable on their own, and the
     * model is a convenience on top rather than a dependency.
     */
    #form(generator: Generator<unknown>, values: Record<string, unknown>): HTMLElement {
        const controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
        const form = div({ className: style.form });

        for (const param of generator.params) {
            const control = this.#control(param, values[param.name]);
            controls.set(param.name, control);
            form.append(label({ textContent: labelFor(param) }), control);
        }

        const apply = button({
            textContent: I18n.translate("ai.apply"),
            onclick: () => {
                const raw: Record<string, unknown> = {};
                for (const [name, control] of controls) {
                    if (control.value.trim()) raw[name] = control.value.trim();
                }
                this.#draw2(generator, raw);
            },
        });
        return div({ className: style.entry }, form, div({ className: style.actions }, apply));
    }

    #control(param: ParamDef, value: unknown): HTMLInputElement | HTMLSelectElement {
        const stop = (e: KeyboardEvent) => e.stopPropagation();
        if (param.type === "enum" && param.values) {
            const control = select(
                { onkeydown: stop },
                ...param.values.map((v) => option({ value: v, textContent: v })),
            );
            control.value = String(value ?? param.default ?? param.values[0]);
            return control;
        }
        return input({
            type: "text",
            value: value === undefined ? String(param.default ?? "") : String(value),
            onkeydown: stop,
        });
    }

    #setBusy(busy: boolean) {
        this.#busy = busy;
        this.#draw.disabled = busy;
        for (const tab of this.#tabs.values()) tab.disabled = busy;
    }
}

/**
 * How much of a transcript precedes the *n*th thing the draftsman said.
 *
 * Counted in user turns rather than array positions: one prompt can leave a `call` turn
 * behind it and a round of questions adds a user turn of its own, so the transcript and
 * the prompt list do not advance in step. An index past the end keeps the whole
 * transcript, which is what a prompt whose turns never made it into history should do -
 * an unconfigured key, or a request that failed before the call.
 */
export function turnsBefore(turns: readonly ConversationTurn[], index: number): number {
    if (index <= 0) return 0;
    let seen = 0;
    for (const [at, turn] of turns.entries()) {
        if (turn.role === "user" && seen++ === index) return at;
    }
    return turns.length;
}

function labelFor(param: ParamDef): string {
    // Parameter names are written for the model; the form wants them readable.
    return param.name
        .replace(/Mm$/, "")
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase())
        .trim();
}

let panel: AiPanel | undefined;

/** Opens the panel, or leaves the one already open alone - asking twice should not stack two. */
export function showAiPanel(application: IApplication): void {
    if (panel?.root.isConnected) return;
    panel = new AiPanel(application);
    PubSub.default.pub("showFloatPanel", {
        title: "ai.header",
        content: panel.root,
        x: 16,
        y: 100,
        // Roomy by default: the prompt box alone is ~110px, and below that a transcript
        // that has to show a drawing preview at a size worth looking at.
        width: 460,
        height: 660,
        minWidth: 340,
        minHeight: 420,
        onClose: () => {
            panel = undefined;
        },
    });
}
