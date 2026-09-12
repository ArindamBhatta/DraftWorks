import {
    command,
    type DimensionSettings,
    DimensionSetup,
    I18n,
    type IApplication,
    type ICommand,
    PubSub,
} from "@draftworks/core";
import { button, div, fieldset, legend, span } from "@draftworks/element";
import { PREVIEW_SAMPLES, renderDimensionPreview, suggestedOverallScale } from "./dimensionPreview";
import style from "./dimensionStyle.module.css";
import { DimensionStyleForm, dimensionStyleTabs } from "./dimensionStyleForm";

/**
 * DIMSTYLE - AutoCAD's Modify Dimension Style dialog: seven tabs of settings with the
 * sample drawing pinned beside them, redrawn on every keystroke.
 *
 * The preview is not decoration. Most of what this dialog controls is an invisible
 * distance or a formatting rule, and four such numbers are hard to judge in the abstract;
 * the same four with a picture beside them are not. It is laid out by
 * `buildDimensionGeometry` - the same function DIMLINEAR, DIMANGULAR and DIMRADIUS call -
 * with the pending settings passed as an override, so it cannot drift from what the
 * drawing will actually do.
 *
 * The dialog also opens as the second step of the new-drawing flow, after unit setup.
 *
 * Resolves when the dialog closes either way (Confirm applies, Cancel leaves the active
 * style untouched), so callers can `await` it to chain the next step.
 */
export function promptDimensionSetup(): Promise<void> {
    return new Promise((resolve) => {
        // Edited in place by the form and never written back to DimensionSetup until
        // Confirm, which is what makes Cancel mean cancel.
        const draft: DimensionSettings = DimensionSetup.settings;

        const preview = div({ className: style.preview });
        const sampleName = span({ className: style.previewName });
        const sampleHint = div({ className: style.previewHint });
        // Which sample figure is on show. The two are at wildly different scales on
        // purpose - see the note in dimensionPreview - so the caption always says which.
        let sample = 0;
        const refreshPreview = () => {
            preview.replaceChildren(renderDimensionPreview(draft, sample));
            sampleName.textContent = I18n.translate(PREVIEW_SAMPLES[sample].name) ?? "";

            // A style too small for the sample draws line work and nothing else, which
            // reads as a broken pane unless it says so and gives the number that fixes it.
            const suggested = suggestedOverallScale(draft, sample);
            sampleHint.textContent =
                suggested === undefined
                    ? ""
                    : (I18n.translate("dimstyle.sample.tooSmall:{0}", suggested) ?? "");
        };
        const nextSample = button({
            className: style.previewNext,
            // Named like the tabs, so it can be found by what it is rather than by the
            // language its tooltip happens to be in.
            name: "dimstyle.sample.next",
            textContent: "›",
            title: I18n.translate("dimstyle.sample.next"),
            onclick: () => {
                sample = (sample + 1) % PREVIEW_SAMPLES.length;
                refreshPreview();
            },
        });

        const form = new DimensionStyleForm(draft, refreshPreview);
        const tabs = dimensionStyleTabs(form, draft);

        const pane = div();
        // Built on first open rather than up front: seven forms is a lot of DOM to make
        // for a dialog most people open to change one number on one tab.
        const built = new Map<number, HTMLElement>();

        const buttons = tabs.map((tab, index) =>
            button({
                className: style.tab,
                // The tab's own key, so a tab can be found by which one it is rather than
                // by the language the caption happens to be rendered in.
                name: tab.caption,
                textContent: I18n.translate(tab.caption),
                onclick: () => show(index),
            }),
        );

        const show = (index: number) => {
            buttons.forEach((element, i) => {
                element.classList.toggle(style.tabActive, i === index);
            });

            let content = built.get(index);
            if (!content) {
                content = tabs[index].build();
                built.set(index, content);
            }
            pane.replaceChildren(content);

            // A tab built earlier can hold a control whose enabled state depends on a
            // field edited since, so the rules are re-run whenever one is shown again.
            form.refreshEnabled();
        };

        const content = div(
            { className: style.root },
            div({ className: style.tabs }, ...buttons),
            div(
                { className: style.body },
                pane,
                fieldset(
                    { className: `${style.group} ${style.previewGroup}` },
                    legend({
                        className: style.groupTitle,
                        textContent: I18n.translate("dimstyle.group.preview"),
                    }),
                    preview,
                    div({ className: style.previewCaption }, sampleName, nextSample),
                    sampleHint,
                ),
            ),
        );

        refreshPreview();
        show(0);

        PubSub.default.pub("showDialog", "dialog.title.dimensionSetup", content, [
            {
                content: "common.confirm",
                onclick: () => {
                    DimensionSetup.configure(draft);
                    resolve();
                },
            },
            {
                content: "common.cancel",
                onclick: () => resolve(),
            },
        ]);
    });
}

@command({
    key: "dimension.setup",
    icon: "icon-measureLength",
})
export class DimensionSetupCommand implements ICommand {
    async execute(_application: IApplication): Promise<void> {
        await promptDimensionSetup();
    }
}
