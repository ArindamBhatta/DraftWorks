// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    DimensionSetup,
    I18n,
    type I18nKeys,
    type IApplication,
    type ICommand,
    PubSub,
    UnitSetup,
} from "@chili3d/core";
import { div, input, option, select, span } from "@chili3d/element";

/**
 * Second step of the new-drawing flow, between unit setup and MV setup - AutoCAD's
 * DIMSTYLE geometry in short form: text height, arrow size, extension-line offset, and
 * the precision a measurement is reported to.
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
                style: { width: "104px" },
                // The dialog lives inside the main window, which routes keystrokes to
                // command hotkeys - without this, typing "5" would fire a command.
                onkeydown: (e) => e.stopPropagation(),
            });

        const textHeight = numberBox(current.textHeight);
        const arrowSize = numberBox(current.arrowSize);
        const extensionOffset = numberBox(current.extensionOffset);

        const sample = span({});
        const precisionSelect = select(
            {
                style: { width: "104px" },
                onchange: () => refreshSample(),
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

        const refreshSample = () => {
            sample.textContent = UnitSetup.formatLength(68.5, {
                precision: Number(precisionSelect.value),
            });
        };
        refreshSample();

        const row = (label: I18nKeys, control: HTMLElement) =>
            div(
                { style: { display: "flex", gap: "12px", alignItems: "center", margin: "6px 0px" } },
                span({ textContent: `${I18n.translate(label)}: `, style: { flex: "1 1 auto" } }),
                control,
            );

        const content = div(
            row("dialog.title.dimTextHeight", textHeight),
            row("dialog.title.dimArrowSize", arrowSize),
            row("dialog.title.dimExtensionOffset", extensionOffset),
            row("dialog.title.dimPrecision", precisionSelect),
            div(span({ textContent: `${I18n.translate("dialog.title.unitSample")}: ` }), sample),
        );

        PubSub.default.pub("showDialog", "dialog.title.dimensionSetup", content, [
            {
                content: "common.confirm",
                onclick: () => {
                    DimensionSetup.configure({
                        textHeight: Number(textHeight.value),
                        arrowSize: Number(arrowSize.value),
                        extensionOffset: Number(extensionOffset.value),
                        precision: Number(precisionSelect.value),
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
    key: "dimension.setup",
    icon: "icon-measureLength",
})
export class DimensionSetupCommand implements ICommand {
    async execute(_application: IApplication): Promise<void> {
        await promptDimensionSetup();
    }
}
