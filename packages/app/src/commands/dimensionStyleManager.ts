/**
 * DIMSTYLE / D - AutoCAD's Dimension Style Manager, the dialog that sits in front of the
 * seven-tab style form: the drawing's styles on the left, and the five things you can do
 * to one of them down the right.
 *
 * The split matters. `promptDimensionSetup` (dimensionSetupCommand) is *Modify Dimension
 * Style* - it edits one style's settings. This is the dialog that says which style there
 * are, which one new dimensions use, and which one Modify is about to open; before it
 * existed, D opened the form directly on the only style there was.
 *
 * - **Set Current** points new dimensions at the selected style, and drops any override.
 * - **New** copies the selected style under a new name.
 * - **Modify** opens the seven-tab form on the selected style.
 * - **Override** opens the same form, but keeps the result as unsaved settings on top of
 *   the current style rather than writing them into it.
 * - **Compare** tables the settings two styles disagree on.
 *
 * Everything here goes straight to `DimensionSetup`, which owns the table and its
 * invariants - this module decides what to offer, not what is legal.
 */

import {
    command,
    type DimensionSettings,
    DimensionSetup,
    I18n,
    type I18nKeys,
    type IApplication,
    type ICommand,
    PubSub,
    sameStyleName,
    uniqueStyleName,
    validateStyleName,
} from "@draftworks/core";
import { button, div, input, option, select, span } from "@draftworks/element";
import { renderDimensionPreview } from "./dimensionPreview";
import { promptDimensionSetup } from "./dimensionSetupCommand";
import style from "./dimensionStyleManager.module.css";

const translate = (key: I18nKeys) => I18n.translate(key) ?? key;

/**
 * The DIM* system variable each setting corresponds to, for the Compare table's second
 * column. Same mapping as the comments in core's `dimensionStyle.ts` - repeated here
 * because Compare is the one place a drafter needs the variable name on screen rather
 * than in the source, which is how AutoCAD's own Compare tab lists them.
 */
const DIM_VARIABLES: Partial<Record<keyof DimensionSettings, string>> = {
    dimLineColor: "DIMCLRD",
    dimLineWeight: "DIMLWD",
    dimLineExtend: "DIMDLE",
    suppressDimLine1: "DIMSD1",
    suppressDimLine2: "DIMSD2",
    extLineColor: "DIMCLRE",
    extLineWeight: "DIMLWE",
    extensionBeyondDimLine: "DIMEXE",
    extensionOffset: "DIMEXO",
    suppressExtLine1: "DIMSE1",
    suppressExtLine2: "DIMSE2",
    fixedExtensionLength: "DIMFXLON",
    extensionLength: "DIMFXL",
    arrowhead1: "DIMBLK1",
    arrowhead2: "DIMBLK2",
    leaderArrowhead: "DIMLDRBLK",
    arrowSize: "DIMASZ",
    centerMark: "DIMCEN",
    centerMarkSize: "DIMCEN",
    textHeight: "DIMTXT",
    textColor: "DIMCLRT",
    textFill: "DIMTFILL",
    textFillColor: "DIMTFILLCLR",
    textVertical: "DIMTAD",
    textHorizontal: "DIMJUST",
    textOffset: "DIMGAP",
    textAlignment: "DIMTIH",
    fit: "DIMATFIT",
    overallScale: "DIMSCALE",
    drawDimLineBetweenExtLines: "DIMTOFL",
    precision: "DIMDEC",
    decimalSeparator: "DIMDSEP",
    roundOff: "DIMRND",
    prefix: "DIMPOST",
    suffix: "DIMPOST",
    measurementScale: "DIMLFAC",
    suppressLeadingZeros: "DIMZIN",
    suppressTrailingZeros: "DIMZIN",
    angularFormat: "DIMAUNIT",
    angularPrecision: "DIMADEC",
    angularSuppressLeadingZeros: "DIMAZIN",
    angularSuppressTrailingZeros: "DIMAZIN",
    alternateEnabled: "DIMALT",
    alternateMultiplier: "DIMALTF",
    alternatePrecision: "DIMALTD",
    alternateRoundOff: "DIMALTRND",
    alternatePrefix: "DIMAPOST",
    alternateSuffix: "DIMAPOST",
    alternatePlacement: "DIMAPOST",
    alternateSuppressLeadingZeros: "DIMALTZ",
    alternateSuppressTrailingZeros: "DIMALTZ",
    toleranceMethod: "DIMTOL",
    tolerancePrecision: "DIMTDEC",
    toleranceUpper: "DIMTP",
    toleranceLower: "DIMTM",
    toleranceTextScale: "DIMTFAC",
    toleranceAlignment: "DIMTOLJ",
    toleranceSuppressLeadingZeros: "DIMTZIN",
    toleranceSuppressTrailingZeros: "DIMTZIN",
};

/** A setting's value as the Compare table shows it. */
const formatValue = (value: unknown): string => {
    if (typeof value === "boolean") return translate(value ? "common.yes" : "common.no");
    if (typeof value === "number") return String(Math.round(value * 10000) / 10000);
    if (value === "") return "—";
    return String(value);
};

/** The name a style-name rule failure is reported under. */
const NAME_ERRORS = {
    empty: "dimstyle.manager.error.empty",
    tooLong: "dimstyle.manager.error.tooLong",
    invalidChars: "dimstyle.manager.error.invalidChars",
    duplicate: "dimstyle.manager.error.duplicate",
} as const satisfies Record<string, I18nKeys>;

/**
 * Opens the manager. Resolves when it closes - it has only a Close button, because every
 * action it offers has already taken effect by then (AutoCAD's manager works the same
 * way: there is nothing to confirm because Modify and Override confirmed themselves).
 */
export function promptDimensionStyleManager(): Promise<void> {
    return new Promise((resolve) => {
        // What the list has highlighted. Tracked by name rather than by index, since the
        // list is re-sorted whenever a style is added or renamed.
        let selected = DimensionSetup.currentStyleName;
        // True when the list's selection is the override row rather than a style. The
        // override is not a style, so it cannot be Set Current, renamed or compared.
        let overrideSelected = false;

        const list = div({ className: style.list });
        const preview = div({ className: style.preview });
        const description = div({ className: style.description });

        const setCurrentButton = actionButton("dimstyle.manager.setCurrent", () => {
            DimensionSetup.setCurrent(selected);
            refresh();
        });

        const newButton = actionButton("dimstyle.manager.new", async () => {
            const created = await promptNewStyle(selected);
            if (created === undefined) return;
            selected = created;
            overrideSelected = false;
            refresh();
        });

        const modifyButton = actionButton("dimstyle.manager.modify", async () => {
            await promptDimensionSetup({ styleName: selected });
            refresh();
        });

        const overrideButton = actionButton("dimstyle.manager.override", async () => {
            await promptDimensionSetup({ mode: "override" });
            // An override always belongs to the current style, so the list's selection
            // follows it there rather than staying on whatever was highlighted.
            selected = DimensionSetup.currentStyleName;
            overrideSelected = DimensionSetup.hasOverride;
            refresh();
        });

        const compareButton = actionButton("dimstyle.manager.compare", async () => {
            await promptCompareStyles(selected);
        });

        const refresh = () => {
            const styles = DimensionSetup.styles;
            const current = DimensionSetup.currentStyleName;

            // A style can vanish under the selection - Modify can rename it - so the
            // selection is re-anchored before anything is drawn from it.
            if (!overrideSelected && DimensionSetup.style(selected) === undefined) {
                selected = current;
            }

            const rows: HTMLElement[] = [];
            for (const item of styles) {
                const isCurrent = sameStyleName(item.name, current);
                const row = button({
                    className: [
                        style.item,
                        isCurrent ? style.itemCurrent : "",
                        !overrideSelected && sameStyleName(item.name, selected) ? style.itemSelected : "",
                    ]
                        .filter(Boolean)
                        .join(" "),
                    // Found by which style it is rather than by the rendered language.
                    name: item.name,
                    textContent: item.name,
                    onclick: () => {
                        selected = item.name;
                        overrideSelected = false;
                        refresh();
                    },
                });
                rows.push(row);

                // The override sits under the style it overrides, as AutoCAD nests it.
                if (isCurrent && DimensionSetup.hasOverride) {
                    rows.push(
                        button({
                            className: [
                                style.item,
                                style.itemOverride,
                                overrideSelected ? style.itemSelected : "",
                            ]
                                .filter(Boolean)
                                .join(" "),
                            name: "dimstyle.manager.overrideRow",
                            textContent: translate("dimstyle.manager.overrideRow"),
                            onclick: () => {
                                selected = item.name;
                                overrideSelected = true;
                                refresh();
                            },
                        }),
                    );
                }
            }
            list.replaceChildren(...rows);

            // The preview shows what is selected, which for the override row is the
            // current style with the override folded in - i.e. what is actually in force.
            const shown = overrideSelected ? DimensionSetup.settings : DimensionSetup.styleFor(selected);
            preview.replaceChildren(renderDimensionPreview(shown));

            description.textContent = overrideSelected
                ? (I18n.translate("dimstyle.manager.describeOverride:{0}", current) ?? "")
                : (I18n.translate(
                      sameStyleName(selected, current)
                          ? "dimstyle.manager.describeCurrent:{0}"
                          : "dimstyle.manager.describeStyle:{0}",
                      selected,
                  ) ?? "");

            // Set Current is pointless on the style that already is current, and
            // meaningless on the override row - which is not a style to be made current.
            setCurrentButton.disabled = overrideSelected || sameStyleName(selected, current);
            // Compare needs two styles to put side by side.
            compareButton.disabled = overrideSelected || styles.length < 2;
        };

        refresh();

        const content = div(
            { className: style.root },
            div(
                { className: style.column },
                span({ className: style.label, textContent: translate("dimstyle.manager.styles") }),
                list,
            ),
            div(
                { className: style.column },
                span({ className: style.label, textContent: translate("dimstyle.group.preview") }),
                preview,
                description,
            ),
            div(
                { className: style.buttons },
                setCurrentButton,
                newButton,
                modifyButton,
                overrideButton,
                compareButton,
            ),
        );

        // One button, and Close rather than Confirm: every action this dialog offers has
        // already taken effect by the time it is reached, so there is nothing to confirm
        // and nothing a Cancel could undo.
        PubSub.default.pub("showDialog", "dialog.title.dimensionStyleManager", content, [
            { content: "common.close", onclick: () => resolve() },
        ]);
    });
}

function actionButton(caption: I18nKeys, onclick: () => void): HTMLButtonElement {
    return button({
        className: style.button,
        // Named by its key so a test can find the button by which one it is.
        name: caption,
        textContent: translate(caption),
        onclick,
    });
}

/**
 * The New Style sub-dialog: a name and the style to copy from. Resolves with the created
 * style's name, or undefined if it was cancelled.
 */
function promptNewStyle(basedOn: string): Promise<string | undefined> {
    return new Promise((resolve) => {
        const names = DimensionSetup.styleNames;
        const nameField = input({
            className: style.input,
            type: "text",
            value: uniqueStyleName(basedOn, names),
        });
        const parentField = select(
            { className: style.input },
            ...names.map((name) => option({ value: name, textContent: name, selected: name === basedOn })),
        );
        const error = div({ className: style.error });

        // Validated as it is typed, so the reason a name will not be accepted is on
        // screen before Confirm is reached rather than after it is pressed.
        const validate = (): boolean => {
            const failure = validateStyleName(nameField.value, DimensionSetup.styleNames);
            error.textContent = failure === undefined ? "" : translate(NAME_ERRORS[failure]);
            return failure === undefined;
        };
        nameField.oninput = () => validate();

        const content = div(
            { className: style.form },
            span({ textContent: translate("dimstyle.manager.newName") }),
            nameField,
            span({ textContent: translate("dimstyle.manager.startFrom") }),
            parentField,
            error,
        );

        PubSub.default.pub("showDialog", "dialog.title.dimensionStyleNew", content, [
            {
                content: "common.confirm",
                // Keeps the dialog open on a bad name instead of silently creating
                // something else under a name the user did not choose.
                shouldClose: () => validate(),
                onclick: () => {
                    if (!validate()) return;
                    resolve(DimensionSetup.createStyle(nameField.value, parentField.value));
                },
            },
            { content: "common.cancel", onclick: () => resolve(undefined) },
        ]);
    });
}

/** The Compare sub-dialog: two style pickers over a table of what they disagree on. */
function promptCompareStyles(first: string): Promise<void> {
    return new Promise((resolve) => {
        const names = DimensionSetup.styleNames;
        const other = names.find((name) => !sameStyleName(name, first)) ?? first;

        const table = div({ className: style.compareTable });
        const picker = (value: string, onchange: (name: string) => void) => {
            const field = select(
                { className: style.input },
                ...names.map((name) => option({ value: name, textContent: name, selected: name === value })),
            );
            field.onchange = () => onchange(field.value);
            return field;
        };

        let a = first;
        let b = other;

        const refresh = () => {
            const differences = DimensionSetup.compare(a, b);
            if (differences.length === 0) {
                table.replaceChildren(
                    div({ className: style.empty, textContent: translate("dimstyle.manager.noDifferences") }),
                );
                return;
            }

            const header = div(
                { className: style.compareRow },
                span({ textContent: translate("dimstyle.manager.setting") }),
                span({ textContent: translate("dimstyle.manager.variable") }),
                span({ textContent: a }),
                span({ textContent: b }),
            );
            const rows = differences.map((difference) =>
                div(
                    { className: style.compareRow },
                    span({ textContent: settingCaption(difference.key) }),
                    span({ className: style.variable, textContent: DIM_VARIABLES[difference.key] ?? "" }),
                    span({ textContent: formatValue(difference.first) }),
                    span({ textContent: formatValue(difference.second) }),
                ),
            );
            table.replaceChildren(header, ...rows);
        };

        refresh();

        const content = div(
            { className: style.compare },
            div(
                { className: style.compareHeader },
                span({ textContent: translate("dimstyle.manager.compareWith") }),
                picker(a, (name) => {
                    a = name;
                    refresh();
                }),
                span({ textContent: translate("dimstyle.manager.compareTo") }),
                picker(b, (name) => {
                    b = name;
                    refresh();
                }),
            ),
            table,
        );

        // Read-only, so Close is the only thing it needs.
        PubSub.default.pub("showDialog", "dialog.title.dimensionStyleCompare", content, [
            { content: "common.close", onclick: () => resolve() },
        ]);
    });
}

/**
 * A setting's caption for the Compare table. The seven-tab form already has a translated
 * caption for every field, but keyed by where it sits in that form rather than by the
 * setting - so Compare falls back to the setting's own name, spaced out, for anything
 * without a key of its own.
 */
function settingCaption(key: keyof DimensionSettings): string {
    const translated = I18n.translate(`dimstyle.setting.${key}` as I18nKeys);
    if (translated !== undefined && !translated.startsWith("dimstyle.setting.")) return translated;
    // `extensionBeyondDimLine` -> `Extension beyond dim line`.
    const spaced = key.replace(/([A-Z])/g, " $1").toLowerCase();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * DIMSTYLE / D. Opens the *manager*, not the seven-tab form: the manager is where the
 * drawing's styles are listed and where Set Current, New, Modify, Override and Compare
 * live, and its Modify button is what leads on to the form.
 */
@command({
    key: "dimension.setup",
    icon: "icon-measureLength",
})
export class DimensionSetupCommand implements ICommand {
    async execute(_application: IApplication): Promise<void> {
        await promptDimensionStyleManager();
    }
}
