import { AiSetup, DEFAULT_MODELS, PROVIDER_IDS, PROVIDER_LABELS, type ProviderId } from "@chili3d/ai";
import { command, I18n, type IApplication, type ICommand, PubSub } from "@chili3d/core";
import { div, input, option, p, select, span } from "@chili3d/element";
import style from "../setupDialog.module.css";

const PLACEHOLDER: Record<ProviderId, string> = {
    anthropic: "sk-ant-...",
    gemini: "AIza...",
};

function row(caption: string, control: HTMLElement) {
    const label = span({ className: style.fieldLabel, textContent: `${caption}:` });
    return { root: div({ className: style.field }, label, control), label };
}

function textBox(value: string, placeholder: string, password = false) {
    return input({
        type: password ? "password" : "text",
        value,
        placeholder,
        className: style.numberBox,
        // The dialog sits inside the main window, which routes keystrokes to command
        // hotkeys - without this, typing into the box fires commands.
        onkeydown: (e) => e.stopPropagation(),
    });
}

/**
 * Where the API key lives.
 *
 * Credentials are held per provider, so switching to Gemini to try it does not discard
 * the Anthropic key - the dialog just swaps which set of boxes it is editing. The note
 * is deliberately here rather than in the docs: a browser-held key is a real trade-off
 * of having no backend, and the person pasting it is the one who should be told.
 */
export function promptAiSetup(): Promise<void> {
    return new Promise((resolve) => {
        // Edited in place, so a key typed for one provider survives a look at the other.
        const draft = AiSetup.settings;
        let provider = draft.provider;

        const key = textBox("", "", true);
        const model = textBox("", "");
        const baseURL = textBox("", "https://your-proxy.example.com");

        const keyRow = row("", key);
        const modelRow = row(I18n.translate("dialog.title.aiModel"), model);
        const baseUrlRow = row(I18n.translate("dialog.title.aiBaseUrl"), baseURL);

        const load = () => {
            const current = draft[provider];
            // Name the provider on the box itself. Labelling it for one vendor while the
            // selector said another is how a Gemini key ends up in an Anthropic field.
            keyRow.label.textContent = `${I18n.translate("dialog.title.aiKey", PROVIDER_LABELS[provider])}:`;
            key.value = current.apiKey;
            key.placeholder = PLACEHOLDER[provider];
            model.value = current.model;
            model.placeholder = DEFAULT_MODELS[provider];
            baseURL.value = current.baseURL;
        };

        const stash = () => {
            draft[provider] = {
                apiKey: key.value.trim(),
                model: model.value.trim() || DEFAULT_MODELS[provider],
                baseURL: baseURL.value.trim(),
            };
        };

        const providerSelect = select(
            {
                className: style.select,
                onchange: () => {
                    stash();
                    provider = providerSelect.value as ProviderId;
                    load();
                },
            },
            ...PROVIDER_IDS.map((id) => option({ value: id, textContent: PROVIDER_LABELS[id] })),
        );
        providerSelect.value = provider;
        load();

        const content = div(
            { className: style.root },
            div(
                { className: style.group },
                row(I18n.translate("dialog.title.aiProvider"), providerSelect).root,
                keyRow.root,
                modelRow.root,
                baseUrlRow.root,
            ),
            p({ className: style.sample, textContent: I18n.translate("dialog.title.aiModelNote") }),
            p({ className: style.sample, textContent: I18n.translate("dialog.title.aiKeyNote") }),
        );

        PubSub.default.pub("showDialog", "dialog.title.aiSetup", content, [
            {
                content: "common.confirm",
                onclick: () => {
                    stash();
                    AiSetup.configure({ ...draft, provider });
                    resolve();
                },
            },
            { content: "common.cancel", onclick: () => resolve() },
        ]);
    });
}

@command({ key: "ai.setup", icon: "icon-units" })
export class AiSetupCommand implements ICommand {
    async execute(_application: IApplication): Promise<void> {
        await promptAiSetup();
    }
}
