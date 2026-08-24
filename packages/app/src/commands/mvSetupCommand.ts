// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    I18n,
    type I18nKeys,
    type IApplication,
    type ICommand,
    MvSetup,
    PAPER_SIZES,
    type PaperSizeName,
    PubSub,
} from "@chili3d/core";
import { div, input, option, select, span } from "@chili3d/element";

const PAPER_OPTIONS: PaperSizeName[] = [...(Object.keys(PAPER_SIZES) as PaperSizeName[]), "Custom"];

/**
 * Third and last step of the new-drawing flow - AutoCAD's MVSETUP: the plot scale and
 * the sheet the drawing is laid out on. Picking a named sheet fills in and locks its
 * millimetre dimensions; "Custom" hands them back to the user.
 *
 * Resolves when the dialog closes either way, matching promptUnitSetup and
 * promptDimensionSetup so the three can be chained.
 */
export function promptMvSetup(): Promise<void> {
    return new Promise((resolve) => {
        const current = MvSetup.settings;

        const numberBox = (value: number) =>
            input({
                type: "number",
                min: "0",
                step: "0.1",
                value: String(value),
                style: { width: "104px" },
                // Stop keystrokes reaching the window-level command hotkeys.
                onkeydown: (e) => e.stopPropagation(),
            });

        const scale = numberBox(current.scale);
        const width = numberBox(current.paperWidth);
        const height = numberBox(current.paperHeight);

        const paperSelect = select(
            {
                style: { width: "104px" },
                onchange: () => applyPaperSize(),
            },
            ...PAPER_OPTIONS.map((name) => option({ value: name, textContent: name })),
        );
        paperSelect.value = current.paperSize;

        const applyPaperSize = () => {
            const name = paperSelect.value as PaperSizeName;
            const custom = name === "Custom";
            width.disabled = !custom;
            height.disabled = !custom;
            if (!custom) {
                width.value = String(PAPER_SIZES[name].width);
                height.value = String(PAPER_SIZES[name].height);
            }
        };
        applyPaperSize();

        const row = (label: I18nKeys, control: HTMLElement) =>
            div(
                { style: { display: "flex", gap: "12px", alignItems: "center", margin: "6px 0px" } },
                span({ textContent: `${I18n.translate(label)}: `, style: { flex: "1 1 auto" } }),
                control,
            );

        const content = div(
            row("dialog.title.mvScale", scale),
            row("dialog.title.mvPaperSize", paperSelect),
            row("dialog.title.mvPaperWidth", width),
            row("dialog.title.mvPaperHeight", height),
        );

        PubSub.default.pub("showDialog", "dialog.title.mvSetup", content, [
            {
                content: "common.confirm",
                onclick: () => {
                    MvSetup.configure({
                        scale: Number(scale.value),
                        paperSize: paperSelect.value as PaperSizeName,
                        paperWidth: Number(width.value),
                        paperHeight: Number(height.value),
                    });
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
    key: "mv.setup",
    icon: "icon-layer",
})
export class MvSetupCommand implements ICommand {
    async execute(_application: IApplication): Promise<void> {
        await promptMvSetup();
    }
}
