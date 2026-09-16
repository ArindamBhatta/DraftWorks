import {
    type CommandKeys,
    CommandPrefix,
    Config,
    DefaultShortcuts,
    FunctionKeyToggles,
    I18n,
    type I18nKeys,
} from "@draftworks/core";
import { div, span } from "@draftworks/element";
import style from "./shortcutPanel.module.css";

/** A row: what the keys are, what they do, and - for a toggle - whether it is on. */
interface Entry {
    keys: string[];
    name: string;
    state?: boolean;
}

interface Group {
    title: I18nKeys;
    entries: Entry[];
}

/**
 * How a `DefaultShortcuts` string is spelled for a reader. The map stores what the
 * matcher needs ("ctrl+shift+z", " "), which is not what anyone wants to look at.
 */
function keyLabel(key: string): string {
    if (key === " ") return "Space";
    return key
        .split("+")
        .map((part) => (part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
        .join("+");
}

function commandName(command: CommandKeys): string {
    // The placeholder command behind Space/Enter has no name of its own - its i18n entry
    // is the literal "__Last_COMMAND__" - so it is described by what it does instead.
    if (command === "special.last") return I18n.translate("shortcuts.repeat");
    return I18n.translate(`${CommandPrefix}${command}` as I18nKeys);
}

/** Which heading a command's shortcut is filed under, by what the command is. */
function groupOf(command: CommandKeys): I18nKeys {
    if (command.startsWith("doc.")) return "shortcuts.group.file";
    if (command.startsWith("edit.") || command === "modify.deleteNode" || command === "special.last") {
        return "shortcuts.group.edit";
    }
    return "shortcuts.group.modify";
}

/**
 * F1: the keyboard reference, built from the same tables the keys are actually bound
 * from - `FunctionKeyToggles` and `DefaultShortcuts` - rather than from a hand-kept list
 * beside them. A help page that has to be remembered separately is a help page that goes
 * out of date the first time a binding moves, and a wrong shortcut list is worse than
 * none: it sends people to a key that does nothing.
 *
 * The drafting aids carry their current ON/OFF state, which makes this a status panel as
 * well as a reference - "is polar on?" is answerable from the same key that answers "how
 * do I turn polar on?".
 */
export class ShortcutPanel extends HTMLElement {
    private static current: ShortcutPanel | undefined;

    /** F1 opens this, and F1 closes it again - see PubSub's `toggleShortcutPanel`. */
    static toggle() {
        if (ShortcutPanel.current) {
            ShortcutPanel.current.close();
            return;
        }
        const panel = new ShortcutPanel();
        document.body.append(panel);
    }

    constructor() {
        super();
        this.className = style.backdrop;
        // A click on the backdrop but not the card is a click outside the panel, which is
        // the other thing everyone tries in order to dismiss one.
        this.onclick = (e) => {
            if (e.target === this) this.close();
        };
        this.render();
    }

    connectedCallback() {
        ShortcutPanel.current = this;
        Config.instance.onPropertyChanged(this.handleConfigChanged);
        window.addEventListener("keydown", this.handleKeyDown, true);
    }

    disconnectedCallback() {
        if (ShortcutPanel.current === this) ShortcutPanel.current = undefined;
        Config.instance.removePropertyChanged(this.handleConfigChanged);
        window.removeEventListener("keydown", this.handleKeyDown, true);
    }

    private close() {
        this.remove();
    }

    private readonly handleKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
    };

    /**
     * The aids can be toggled while the panel is open - by their function keys, which
     * keep working, or from the status bar behind it - so the ON/OFF column has to
     * follow rather than show whatever was true when it opened.
     */
    private readonly handleConfigChanged = () => {
        this.innerHTML = "";
        this.render();
    };

    private render() {
        this.append(
            div(
                { className: style.card },
                div(
                    { className: style.header },
                    span({ className: style.title, textContent: I18n.translate("shortcuts.title") }),
                    span({
                        className: style.close,
                        textContent: "Esc",
                        title: I18n.translate("shortcuts.close"),
                        onclick: () => this.close(),
                    }),
                ),
                div({ className: style.groups }, ...this.groups().map(renderGroup)),
                div({ className: style.hint, textContent: I18n.translate("shortcuts.hint") }),
            ),
        );
    }

    private groups(): Group[] {
        const groups: Group[] = [
            {
                title: "shortcuts.group.draftingAids",
                entries: FunctionKeyToggles.map((toggle) => ({
                    keys: [toggle.key],
                    // Polar names the angles it is tracking at, since "Polar ON" alone
                    // does not answer the question anyone actually has about it.
                    name:
                        toggle.property === "enablePolarTracking"
                            ? `${I18n.translate(toggle.label)} (${Config.instance.polarAngles
                                  .map((a) => `${a}°`)
                                  .join(", ")})`
                            : I18n.translate(toggle.label),
                    state: Config.instance[toggle.property],
                })),
            },
            {
                title: "shortcuts.group.window",
                entries: [
                    { keys: ["F1"], name: I18n.translate("shortcuts.help") },
                    { keys: ["F2"], name: I18n.translate("shortcuts.commandHistory") },
                ],
            },
        ];

        // Everything else comes straight out of the map HotkeyService matches against.
        for (const [command, keyOrKeys] of Object.entries(DefaultShortcuts)) {
            const title = groupOf(command as CommandKeys);
            const entry: Entry = {
                keys: (Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]).map(keyLabel),
                name: commandName(command as CommandKeys),
            };
            const existing = groups.find((g) => g.title === title);
            if (existing) existing.entries.push(entry);
            else groups.push({ title, entries: [entry] });
        }

        return groups;
    }
}

function renderGroup(group: Group) {
    return div(
        { className: style.group },
        div({ className: style.groupTitle, textContent: I18n.translate(group.title) }),
        ...group.entries.map(renderEntry),
    );
}

function renderEntry(entry: Entry) {
    const keys = div(
        { className: style.keys },
        // Alternatives, not a chord: Ctrl+Y *or* Ctrl+Shift+Z. Joined with "/" so the two
        // do not read as keys to press together.
        ...entry.keys.flatMap((key, i) => {
            const kbd = span({ className: style.key, textContent: key });
            return i === 0 ? [kbd] : [span({ className: style.or, textContent: "/" }), kbd];
        }),
    );

    const children = [keys, span({ className: style.name, textContent: entry.name })];
    if (entry.state !== undefined) {
        children.push(
            span({
                className: `${style.state} ${entry.state ? style.on : style.off}`,
                textContent: I18n.translate(entry.state ? "shortcuts.on" : "shortcuts.off"),
            }),
        );
    }
    return div({ className: style.entry }, ...children);
}

customElements.define("chili-shortcut-panel", ShortcutPanel);
