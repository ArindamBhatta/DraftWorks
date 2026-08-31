// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    type DimensionSettings,
    DimensionSetup,
    I18n,
    type I18nKeys,
    type IApplication,
    type ICommand,
    PubSub,
    UnitSetup,
} from "@chili3d/core";
import { div, fieldset, input, legend, option, select, span } from "@chili3d/element";
import { renderDimensionPreview } from "./dimensionPreview";
import style from "./setupDialog.module.css";

/**
 * Second step of the new-drawing flow, between unit setup and MV setup - AutoCAD's
 * DIMSTYLE geometry in short form, laid out the way the Dimension Style dialog lays it
 * out: the settings on the left, and a sample drawing on the right that redraws on every
 * keystroke. Four numbers describing invisible distances are hard to judge; the same
 * four with a picture beside them are not.
 *
 * Precision deliberately reuses UnitSetup's options for the *active* unit type rather
 * than being a plain decimal-places box, because precision means a fraction denominator
 * under architectural/fractional units and decimal places otherwise (see UnitSetup) -
 * a raw "2" would silently mean "1/2 inch" in an architectural drawing.
 *
 * Resolves when the dialog closes either way (Confirm applies, Cancel leaves settings
 * untouched), so callers can `await` it to chain the next step.
 */
export function promptDimensionSetup(): Promise<void> {
    return new Promise((resolve) => {
        const current = DimensionSetup.settings;
        const unitType = UnitSetup.settings.type;

        const numberBox = (value: number) =>
            input({
                type: "number",
                min: "0",
                step: "0.1",
                value: String(value),
                className: style.numberBox,
                // The dialog lives inside the main window, which routes keystrokes to
                // command hotkeys - without this, typing "5" would fire a command.
                onkeydown: (e) => e.stopPropagation(),
                oninput: () => refreshPreview(),
            });

        const textHeight = numberBox(current.textHeight);
        const arrowSize = numberBox(current.arrowSize);
        const extensionOffset = numberBox(current.extensionOffset);

        const precisionSelect = select(
            {
                className: style.select,
                onchange: () => refreshPreview(),
            },
            ...UnitSetup.precisionOptions(unitType).map((value) =>
                option({
                    value: String(value),
                    textContent: UnitSetup.precisionLabel(unitType, value),
                }),
            ),
        );
        precisionSelect.value = String(current.precision);
        if (precisionSelect.selectedIndex < 0) {
            precisionSelect.value = String(UnitSetup.defaultPrecision(unitType));
        }

        /**
         * What the boxes currently say. Falls back to the active setting for a box that
         * is empty or mid-edit ("2." while typing "2.5"), so the preview keeps drawing
         * instead of collapsing every time a field is cleared.
         */
        const pendingSettings = (): DimensionSettings => {
            const read = (box: HTMLInputElement, fallback: number) => {
                const value = Number(box.value);
                return Number.isFinite(value) && value >= 0 ? value : fallback;
            };
            return {
                textHeight: read(textHeight, current.textHeight),
                arrowSize: read(arrowSize, current.arrowSize),
                extensionOffset: read(extensionOffset, current.extensionOffset),
                precision: Number(precisionSelect.value),
            };
        };

        const preview = div({ className: style.preview });
        const refreshPreview = () => {
            preview.replaceChildren(renderDimensionPreview(pendingSettings()));
        };
        refreshPreview();

        const row = (label: I18nKeys, control: HTMLElement) => [
            span({ className: style.rowLabel, textContent: `${I18n.translate(label)}:` }),
            control,
        ];

        const content = div(
            { className: style.root },
            div(
                { className: style.split },
                fieldset(
                    { className: style.group },
                    legend({
                        className: style.groupTitle,
                        textContent: I18n.translate("dialog.title.dimGeometry"),
                    }),
                    div(
                        { className: style.rows },
                        ...row("dialog.title.dimTextHeight", textHeight),
                        ...row("dialog.title.dimArrowSize", arrowSize),
                        ...row("dialog.title.dimExtensionOffset", extensionOffset),
                        ...row("dialog.title.dimPrecision", precisionSelect),
                    ),
                ),
                fieldset(
                    { className: style.group },
                    legend({
                        className: style.groupTitle,
                        textContent: I18n.translate("dialog.title.dimPreview"),
                    }),
                    preview,
                ),
            ),
        );

        PubSub.default.pub("showDialog", "dialog.title.dimensionSetup", content, [
            {
                content: "common.confirm",
                onclick: () => {
                    DimensionSetup.configure(pendingSettings());
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
