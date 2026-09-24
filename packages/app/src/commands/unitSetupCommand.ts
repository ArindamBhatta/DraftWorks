import {
    type BaseUnit,
    command,
    I18n,
    type IApplication,
    type ICommand,
    PubSub,
    UnitSetup,
    type UnitType,
} from "@draftworks/core";
import { div, fieldset, legend, option, select, span } from "@draftworks/element";
import style from "./setupDialog.module.css";

/**
 * AutoCAD lists the length formats alphabetically and names them plainly - no worked
 * example beside each one. The examples belong in Sample Output, which shows the format
 * you actually chose at the precision you actually chose, rather than five frozen
 * strings that stop being true the moment precision changes.
 */
const LENGTH_TYPES: { label: string; type: UnitType }[] = [
    { label: "Architectural", type: "architectural" },
    { label: "Decimal", type: "decimal" },
    { label: "Engineering", type: "engineering" },
    { label: "Fractional", type: "fractional" },
    { label: "Scientific", type: "scientific" },
];

/**
 * AutoCAD's "Units to scale inserted content". This is `UnitSetup.settings.baseUnit`,
 * which decides how many inches one drawing unit is worth and so drives every
 * feet-and-inches format - it has always been part of the settings, and until now the
 * dialog gave no way to see or change it.
 */
const INSERTION_UNITS: { label: string; unit: BaseUnit }[] = [
    { label: "Millimeters", unit: "mm" },
    { label: "Centimeters", unit: "cm" },
    { label: "Meters", unit: "m" },
    { label: "Inches", unit: "in" },
    { label: "Feet", unit: "ft" },
];

/**
 * The numbers behind Sample Output: one distance and one coordinate pair, the way
 * AutoCAD samples both. Formatted through the live formatter, so what the dialog
 * promises and what the drawing renders cannot drift apart.
 */
const SAMPLE_LENGTH = 68.5;
const SAMPLE_POINT: [number, number] = [18, 27.25];

/** A captioned dropdown - the single control shape this dialog is built from. */
function field(caption: string, onchange: () => void) {
    const control = select({ className: style.select, onchange });
    const root = div(
        { className: style.field },
        span({ className: style.fieldLabel, textContent: `${caption}:` }),
        control,
    );
    return { control, root };
}

function fillOptions(control: HTMLSelectElement, labels: string[], selected: string) {
    control.replaceChildren(...labels.map((label) => option({ value: label, textContent: label })));
    control.value = selected;
}

function group(title: string, ...children: HTMLElement[]) {
    return fieldset(
        { className: style.group },
        legend({ className: style.groupTitle, textContent: title }),
        ...children,
    );
}

/**
 * AutoCAD's Drawing Units dialog.
 *
 * Shared by UnitSetupCommand (ribbon / the "UN" shortcut) and NewDocument (shown when
 * starting a new drawing, AutoCAD-style). Resolves once the dialog closes either way -
 * Confirm applies the settings, Cancel leaves the current ones untouched - so a caller
 * can `await` it to gate work on the dialog finishing.
 */
export function promptUnitSetup(): Promise<void> {
    return new Promise((resolve) => {
        // Seeded from the live settings, so the dialog opens showing what the drawing is
        // actually using rather than resetting to Architectural every time it appears.
        const current = UnitSetup.settings;
        let type = current.type;
        let precision = current.precision;
        let baseUnit = current.baseUnit;

        const sampleLength = div({});
        const samplePoint = div({});

        const refreshSample = () => {
            const settings = { type, precision, baseUnit };
            sampleLength.textContent = UnitSetup.formatLength(SAMPLE_LENGTH, settings);
            samplePoint.textContent = SAMPLE_POINT.map((value) =>
                UnitSetup.formatLength(value, settings),
            ).join(", ");
        };

        const typeField = field(I18n.translate("dialog.title.unitType"), () => {
            type = LENGTH_TYPES.find((x) => x.label === typeField.control.value)?.type ?? type;
            // Precision means different things per type - a fraction denominator for
            // architectural, decimal places for decimal - so re-default it rather than
            // carry a value across that would be nonsense in the new format.
            precision = UnitSetup.defaultPrecision(type);
            refreshPrecisions();
            refreshSample();
        });

        const precisionField = field(I18n.translate("dialog.title.unitPrecision"), () => {
            const options = UnitSetup.precisionOptions(type);
            precision =
                options.find(
                    (value) => UnitSetup.precisionLabel(type, value) === precisionField.control.value,
                ) ?? precision;
            refreshSample();
        });

        const insertionField = field(I18n.translate("dialog.title.unitInsertionContent"), () => {
            baseUnit =
                INSERTION_UNITS.find((x) => x.label === insertionField.control.value)?.unit ?? baseUnit;
            refreshSample();
        });

        const refreshPrecisions = () => {
            fillOptions(
                precisionField.control,
                UnitSetup.precisionOptions(type).map((value) => UnitSetup.precisionLabel(type, value)),
                UnitSetup.precisionLabel(type, precision),
            );
        };

        fillOptions(
            typeField.control,
            LENGTH_TYPES.map((x) => x.label),
            LENGTH_TYPES.find((x) => x.type === type)?.label ?? LENGTH_TYPES[0].label,
        );
        fillOptions(
            insertionField.control,
            INSERTION_UNITS.map((x) => x.label),
            INSERTION_UNITS.find((x) => x.unit === baseUnit)?.label ?? INSERTION_UNITS[3].label,
        );
        refreshPrecisions();
        refreshSample();

        const content = div(
            { className: style.root },
            div(
                { className: style.columns },
                group(I18n.translate("dialog.title.unitLength"), typeField.root, precisionField.root),
                group(I18n.translate("dialog.title.unitInsertionScale"), insertionField.root),
            ),
            group(
                I18n.translate("dialog.title.unitSample"),
                div({ className: style.sample }, sampleLength, samplePoint),
            ),
        );

        PubSub.default.pub("showDialog", "dialog.title.unitSetup", content, [
            {
                content: "common.confirm",
                onclick: () => {
                    UnitSetup.configure({ type, precision, baseUnit });
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
