// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    I18n,
    type IApplication,
    type ICommand,
    Observable,
    PubSub,
    property,
    SelectableItems,
    UnitSetup,
    type UnitType,
} from "@chili3d/core";
import { div, option, RadioGroup, select, span } from "@chili3d/element";

const UNIT_TYPE_OPTIONS: { label: string; type: UnitType }[] = [
    { label: "Architectural (5'-8 1/2\")", type: "architectural" },
    { label: "Engineering (5.7083')", type: "engineering" },
    { label: "Decimal (1745.50)", type: "decimal" },
    { label: "Fractional (5 3/4)", type: "fractional" },
    { label: "Scientific (1.7455E+03)", type: "scientific" },
];

/**
 * 68.5 drawing units - the value behind the Architectural and Engineering examples in
 * the option labels above (5'-8 1/2" and 5.7083'). The Sample Output line formats this
 * with the live formatter, so what the dialog promises and what the app renders cannot
 * drift apart.
 */
const SAMPLE_VALUE = 68.5;

export class UnitsViewModel extends Observable {
    @property("dialog.title.unitType")
    unitTypes: SelectableItems<string> = new SelectableItems(
        UNIT_TYPE_OPTIONS.map((x) => x.label),
        "radio",
        [UNIT_TYPE_OPTIONS[0].label],
    );
}

function selectedType(vm: UnitsViewModel): UnitType {
    const label = vm.unitTypes.firstSelectedItem();
    return UNIT_TYPE_OPTIONS.find((x) => x.label === label)?.type ?? "architectural";
}

/**
 * Shared by UnitSetupCommand (ribbon / the "UN" shortcut) and NewDocument (shown when
 * starting a new drawing, AutoCAD-style). Resolves once the dialog closes either way -
 * Confirm applies the chosen type and precision, Cancel leaves the current settings
 * untouched - so a caller can `await` it to gate work on the dialog finishing.
 */
export function promptUnitSetup(): Promise<void> {
    return new Promise((resolve) => {
        const vm = new UnitsViewModel();
        let type = selectedType(vm);
        let precision = UnitSetup.defaultPrecision(type);

        const sample = span({});
        const precisionSelect = select({
            onchange: () => {
                precision = Number(precisionSelect.value);
                refreshSample();
            },
        });

        const refreshSample = () => {
            sample.textContent = UnitSetup.formatLength(SAMPLE_VALUE, { type, precision });
        };

        const refreshPrecisions = () => {
            precisionSelect.replaceChildren(
                ...UnitSetup.precisionOptions(type).map((value) =>
                    option({
                        value: String(value),
                        textContent: UnitSetup.precisionLabel(type, value),
                    }),
                ),
            );
            precisionSelect.value = String(precision);
        };

        const radios = new RadioGroup(I18n.translate("dialog.title.unitType"), vm.unitTypes);
        const content = div(
            // Listening on the wrapper rather than on RadioGroup itself so this runs
            // after RadioGroup's own click handler has updated the selection.
            {
                onclick: () => {
                    const next = selectedType(vm);
                    if (next === type) return;
                    type = next;
                    // Precision means different things per type (fraction denominator vs
                    // decimal places), so re-default it rather than carry it across.
                    precision = UnitSetup.defaultPrecision(type);
                    refreshPrecisions();
                    refreshSample();
                },
            },
            radios,
            div(span({ textContent: `${I18n.translate("dialog.title.unitPrecision")}: ` }), precisionSelect),
            div(span({ textContent: `${I18n.translate("dialog.title.unitSample")}: ` }), sample),
        );

        refreshPrecisions();
        refreshSample();

        PubSub.default.pub("showDialog", "dialog.title.unitSetup", content, [
            {
                content: "common.confirm",
                onclick: () => {
                    UnitSetup.configure({ type, precision });
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
    key: "units.setup",
    icon: "icon-units",
})
export class UnitSetupCommand implements ICommand {
    async execute(_application: IApplication): Promise<void> {
        await promptUnitSetup();
    }
}
