/**
 * The seven tabs of AutoCAD's Modify Dimension Style dialog, and the handful of control
 * factories they are built from.
 *
 * Everything here edits one mutable draft of `DimensionSettings` and calls back on every
 * keystroke so the preview beside it redraws - nothing is written to `DimensionSetup`
 * until the dialog is confirmed, which is what makes Cancel mean cancel.
 *
 * The tabs are laid out in AutoCAD's order and use its group boxes and wording, so a
 * drafter who knows DIMSTYLE can find a setting here without hunting. What is *not* here
 * is the set of AutoCAD options this app has nothing to apply them to - see the note at
 * the top of `dimensionStyle.ts` in core.
 */

import {
    ALTERNATE_PLACEMENTS,
    ANGULAR_FORMATS,
    ARROWHEAD_TYPES,
    CENTER_MARK_TYPES,
    DIMENSION_COLORS,
    type DimensionColor,
    type DimensionSettings,
    FIT_OPTIONS,
    I18n,
    type I18nKeys,
    TEXT_ALIGNMENTS,
    TEXT_FILL_TYPES,
    TEXT_HORIZONTAL_PLACEMENTS,
    TEXT_VERTICAL_PLACEMENTS,
    TOLERANCE_ALIGNMENTS,
    TOLERANCE_METHODS,
    UnitSetup,
} from "@chili3d/core";
import { div, fieldset, input, label, legend, option, select, span } from "@chili3d/element";
import style from "./dimensionStyle.module.css";

/**
 * Keys of `DimensionSettings` whose value is exactly `T`.
 *
 * Mutual assignability rather than a plain `extends`, so that `ArrowheadType` and friends
 * - which are unions of string literals, and so do extend `string` - are not offered to
 * the free-text control that would let anything at all be typed into them.
 */
type KeysOf<T> = {
    [K in keyof DimensionSettings]: [DimensionSettings[K]] extends [T]
        ? [T] extends [DimensionSettings[K]]
            ? K
            : never
        : never;
}[keyof DimensionSettings];

type NumberKey = KeysOf<number>;
type BooleanKey = KeysOf<boolean>;
type TextKey = KeysOf<string>;

const translate = (key: I18nKeys) => I18n.translate(key) ?? key;

/**
 * Builds the controls for one draft. Every control writes straight into the draft and
 * calls `onChange`; there is no separate "read the form back" pass, so a field can never
 * be edited into a state the preview is not already showing.
 */
export class DimensionStyleForm {
    constructor(
        private readonly draft: DimensionSettings,
        private readonly onChange: () => void,
    ) {}

    /** Enable/disable rules that depend on other fields, re-run after every change. */
    private readonly dependents: (() => void)[] = [];

    /** Re-applies the cross-field enabling rules. Called by the dialog after a change. */
    refreshEnabled() {
        for (const apply of this.dependents) apply();
    }

    /** Greys `element` out whenever `enabled` says the setting has nothing to act on. */
    private gated<T extends HTMLElement & { disabled: boolean }>(element: T, enabled: () => boolean): T {
        const apply = () => {
            element.disabled = !enabled();
        };
        this.dependents.push(apply);
        apply();
        return element;
    }

    private changed() {
        this.refreshEnabled();
        this.onChange();
    }

    number(key: NumberKey, options?: { step?: string; min?: string; enabled?: () => boolean }) {
        const box = input({
            type: "number",
            // The settings key, so a control can be found by what it edits - which is how
            // the tests address them, and how a stray one is identified in the DOM.
            name: key,
            step: options?.step ?? "0.1",
            min: options?.min ?? "0",
            value: String(this.draft[key]),
            className: style.control,
            // The dialog lives inside the main window, which routes keystrokes to command
            // hotkeys - without this, typing "5" would fire a command.
            onkeydown: (e) => e.stopPropagation(),
            oninput: () => {
                const value = Number(box.value);
                // An empty or half-typed box ("2." on the way to "2.5") keeps the last
                // good value rather than collapsing the preview to zero.
                if (box.value !== "" && Number.isFinite(value)) {
                    (this.draft[key] as number) = value;
                }
                this.changed();
            },
        });
        return options?.enabled ? this.gated(box, options.enabled) : box;
    }

    text(key: TextKey, options?: { maxLength?: number; enabled?: () => boolean }) {
        const box = input({
            type: "text",
            name: key,
            value: this.draft[key],
            maxLength: options?.maxLength ?? 32,
            className: style.control,
            onkeydown: (e) => e.stopPropagation(),
            oninput: () => {
                (this.draft[key] as string) = box.value;
                this.changed();
            },
        });
        return options?.enabled ? this.gated(box, options.enabled) : box;
    }

    /** A dropdown over a fixed set of values, each labelled by its own i18n key. */
    choice<K extends keyof DimensionSettings, V extends DimensionSettings[K] & string>(
        key: K,
        values: readonly V[],
        labelFor: (value: V) => I18nKeys,
        options?: { enabled?: () => boolean },
    ) {
        const box = select(
            {
                className: style.control,
                name: String(key),
                onchange: () => {
                    (this.draft[key] as V) = box.value as V;
                    this.changed();
                },
            },
            ...values.map((value) => option({ value, textContent: translate(labelFor(value)) })),
        );
        box.value = this.draft[key] as string;
        return options?.enabled ? this.gated(box, options.enabled) : box;
    }

    check(key: BooleanKey, caption: I18nKeys, options?: { enabled?: () => boolean }) {
        const box = input({
            type: "checkbox",
            name: key,
            checked: this.draft[key],
            onchange: () => {
                (this.draft[key] as boolean) = box.checked;
                this.changed();
            },
        });
        if (options?.enabled) this.gated(box, options.enabled);
        return label({ className: style.check }, box, span({ textContent: translate(caption) }));
    }

    /** A radio list, for the two places AutoCAD uses one instead of a dropdown. */
    radios<K extends keyof DimensionSettings, V extends DimensionSettings[K] & string>(
        key: K,
        values: readonly V[],
        labelFor: (value: V) => I18nKeys,
    ) {
        // Radios only group within a name, and two lists in one dialog would otherwise
        // share it and switch each other off.
        const group = `dimstyle-${String(key)}`;
        return div(
            { className: style.radios },
            ...values.map((value) => {
                const box = input({
                    type: "radio",
                    name: group,
                    value,
                    checked: this.draft[key] === value,
                    onchange: () => {
                        if (!box.checked) return;
                        (this.draft[key] as V) = value;
                        this.changed();
                    },
                });
                return label(
                    { className: style.check },
                    box,
                    span({ textContent: translate(labelFor(value)) }),
                );
            }),
        );
    }

    /**
     * The Precision dropdown, which reuses UnitSetup's options for the *active* unit type
     * rather than being a plain decimal-places box - precision means a fraction
     * denominator under architectural/fractional units and decimal places otherwise, so a
     * raw "2" would silently mean "1/2 inch" in an architectural drawing.
     */
    precision() {
        const unitType = UnitSetup.settings.type;
        const box = select(
            {
                className: style.control,
                name: "precision",
                onchange: () => {
                    this.draft.precision = Number(box.value);
                    this.changed();
                },
            },
            ...UnitSetup.precisionOptions(unitType).map((value) =>
                option({
                    value: String(value),
                    textContent: UnitSetup.precisionLabel(unitType, value),
                }),
            ),
        );
        box.value = String(this.draft.precision);
        // A precision carried over from another unit type has no option to select here.
        if (box.selectedIndex < 0) box.value = String(UnitSetup.defaultPrecision(unitType));
        return box;
    }

    /** A plain decimal-places dropdown, for the quantities that are always decimal. */
    decimals(key: NumberKey, options?: { enabled?: () => boolean }) {
        const box = select(
            {
                className: style.control,
                name: key,
                onchange: () => {
                    (this.draft[key] as number) = Number(box.value);
                    this.changed();
                },
            },
            ...Array.from({ length: 9 }, (_, places) =>
                option({
                    value: String(places),
                    textContent: places === 0 ? "0" : `0.${"0".repeat(places)}`,
                }),
            ),
        );
        box.value = String(this.draft[key]);
        if (box.selectedIndex < 0) box.value = "2";
        return options?.enabled ? this.gated(box, options.enabled) : box;
    }

    color(key: KeysOf<DimensionColor>, options?: { enabled?: () => boolean }) {
        return this.choice(
            key,
            Object.keys(DIMENSION_COLORS) as DimensionColor[],
            (value) => `dimstyle.color.${value}` as I18nKeys,
            options,
        );
    }
}

// --- Layout helpers --------------------------------------------------------------

/** A captioned group box, as every block of AutoCAD's dialog is fenced into. */
const group = (title: I18nKeys, ...children: (Node | undefined)[]) =>
    fieldset(
        { className: style.group },
        legend({ className: style.groupTitle, textContent: translate(title) }),
        ...(children.filter(Boolean) as Node[]),
    );

/** Caption + control pairs sharing one grid, so the controls line up down the box. */
const rows = (...pairs: [I18nKeys, HTMLElement][]) =>
    div(
        { className: style.rows },
        ...pairs.flatMap(([caption, control]) => [
            span({ className: style.rowLabel, textContent: `${translate(caption)}:` }),
            control,
        ]),
    );

/** A line of checkboxes, the way Suppress and Zero suppression are laid out. */
const checkRow = (caption: I18nKeys | undefined, ...boxes: HTMLElement[]) =>
    div(
        { className: style.checkRow },
        ...(caption ? [span({ className: style.rowLabel, textContent: `${translate(caption)}:` })] : []),
        ...boxes,
    );

const arrowLabel = (value: string) => `dimstyle.arrow.${value}` as I18nKeys;

export interface StyleTab {
    caption: I18nKeys;
    build: () => HTMLElement;
}

/**
 * The seven tabs, in AutoCAD's order. Built lazily - a tab's controls are created the
 * first time it is opened, so the dialog does not pay for six hidden forms on the way up.
 */
export function dimensionStyleTabs(form: DimensionStyleForm, draft: DimensionSettings): StyleTab[] {
    return [
        {
            caption: "dimstyle.tab.lines",
            build: () =>
                div(
                    { className: style.pane },
                    group(
                        "dimstyle.group.dimensionLines",
                        rows(
                            ["dimstyle.field.color", form.color("dimLineColor")],
                            [
                                "dimstyle.field.lineweight",
                                form.number("dimLineWeight", { step: "0.5", min: "0.5" }),
                            ],
                            // DIMDLE only draws with tick-style heads, which is AutoCAD's
                            // rule too - the note is in the geometry, not the label.
                            ["dimstyle.field.extendBeyondTicks", form.number("dimLineExtend")],
                        ),
                        checkRow(
                            "dimstyle.field.suppress",
                            form.check("suppressDimLine1", "dimstyle.field.dimLine1"),
                            form.check("suppressDimLine2", "dimstyle.field.dimLine2"),
                        ),
                    ),
                    group(
                        "dimstyle.group.extensionLines",
                        rows(
                            ["dimstyle.field.color", form.color("extLineColor")],
                            [
                                "dimstyle.field.lineweight",
                                form.number("extLineWeight", { step: "0.5", min: "0.5" }),
                            ],
                            ["dimstyle.field.extendBeyondDimLines", form.number("extensionBeyondDimLine")],
                            ["dimstyle.field.offsetFromOrigin", form.number("extensionOffset")],
                        ),
                        checkRow(
                            "dimstyle.field.suppress",
                            form.check("suppressExtLine1", "dimstyle.field.extLine1"),
                            form.check("suppressExtLine2", "dimstyle.field.extLine2"),
                        ),
                        checkRow(
                            undefined,
                            form.check("fixedExtensionLength", "dimstyle.field.fixedLengthExtLines"),
                        ),
                        rows([
                            "dimstyle.field.length",
                            form.number("extensionLength", { enabled: () => draft.fixedExtensionLength }),
                        ]),
                    ),
                ),
        },
        {
            caption: "dimstyle.tab.symbols",
            build: () =>
                div(
                    { className: style.pane },
                    group(
                        "dimstyle.group.arrowheads",
                        rows(
                            ["dimstyle.field.first", form.choice("arrowhead1", ARROWHEAD_TYPES, arrowLabel)],
                            ["dimstyle.field.second", form.choice("arrowhead2", ARROWHEAD_TYPES, arrowLabel)],
                            [
                                "dimstyle.field.leader",
                                form.choice("leaderArrowhead", ARROWHEAD_TYPES, arrowLabel),
                            ],
                            ["dimstyle.field.arrowSize", form.number("arrowSize")],
                        ),
                    ),
                    group(
                        "dimstyle.group.centerMarks",
                        rows(
                            [
                                "dimstyle.field.type",
                                form.choice(
                                    "centerMark",
                                    CENTER_MARK_TYPES,
                                    (value) => `dimstyle.centerMark.${value}` as I18nKeys,
                                ),
                            ],
                            [
                                "dimstyle.field.size",
                                form.number("centerMarkSize", { enabled: () => draft.centerMark !== "none" }),
                            ],
                        ),
                    ),
                ),
        },
        {
            caption: "dimstyle.tab.text",
            build: () =>
                div(
                    { className: style.pane },
                    group(
                        "dimstyle.group.textAppearance",
                        rows(
                            ["dimstyle.field.textColor", form.color("textColor")],
                            [
                                "dimstyle.field.fill",
                                form.choice(
                                    "textFill",
                                    TEXT_FILL_TYPES,
                                    (value) => `dimstyle.fill.${value}` as I18nKeys,
                                ),
                            ],
                            [
                                "dimstyle.field.fillColor",
                                form.color("textFillColor", { enabled: () => draft.textFill === "color" }),
                            ],
                            ["dimstyle.field.textHeight", form.number("textHeight")],
                        ),
                    ),
                    group(
                        "dimstyle.group.textPlacement",
                        rows(
                            [
                                "dimstyle.field.vertical",
                                form.choice(
                                    "textVertical",
                                    TEXT_VERTICAL_PLACEMENTS,
                                    (value) => `dimstyle.vertical.${value}` as I18nKeys,
                                ),
                            ],
                            [
                                "dimstyle.field.horizontal",
                                form.choice(
                                    "textHorizontal",
                                    TEXT_HORIZONTAL_PLACEMENTS,
                                    (value) => `dimstyle.horizontal.${value}` as I18nKeys,
                                ),
                            ],
                            ["dimstyle.field.offsetFromDimLine", form.number("textOffset")],
                        ),
                    ),
                    group(
                        "dimstyle.group.textAlignment",
                        form.radios(
                            "textAlignment",
                            TEXT_ALIGNMENTS,
                            (value) => `dimstyle.alignment.${value}` as I18nKeys,
                        ),
                    ),
                ),
        },
        {
            caption: "dimstyle.tab.fit",
            build: () =>
                div(
                    { className: style.pane },
                    group(
                        "dimstyle.group.fitOptions",
                        div({ className: style.hint, textContent: translate("dimstyle.fit.explain") }),
                        form.radios("fit", FIT_OPTIONS, (value) => `dimstyle.fit.${value}` as I18nKeys),
                    ),
                    group(
                        "dimstyle.group.scale",
                        rows(["dimstyle.field.overallScale", form.number("overallScale", { min: "0.01" })]),
                    ),
                    group(
                        "dimstyle.group.fineTuning",
                        checkRow(
                            undefined,
                            form.check("drawDimLineBetweenExtLines", "dimstyle.field.drawDimLineBetween"),
                        ),
                    ),
                ),
        },
        {
            caption: "dimstyle.tab.primaryUnits",
            build: () =>
                div(
                    { className: style.pane },
                    group(
                        "dimstyle.group.linear",
                        rows(
                            ["dimstyle.field.precision", form.precision()],
                            [
                                "dimstyle.field.decimalSeparator",
                                form.text("decimalSeparator", { maxLength: 1 }),
                            ],
                            ["dimstyle.field.roundOff", form.number("roundOff", { step: "0.01" })],
                            ["dimstyle.field.prefix", form.text("prefix")],
                            ["dimstyle.field.suffix", form.text("suffix")],
                            [
                                "dimstyle.field.measurementScale",
                                form.number("measurementScale", { min: "0.0001" }),
                            ],
                        ),
                        checkRow(
                            "dimstyle.group.zeroSuppression",
                            form.check("suppressLeadingZeros", "dimstyle.field.leadingZeros"),
                            form.check("suppressTrailingZeros", "dimstyle.field.trailingZeros"),
                        ),
                    ),
                    group(
                        "dimstyle.group.angular",
                        rows(
                            [
                                "dimstyle.field.units",
                                form.choice(
                                    "angularFormat",
                                    ANGULAR_FORMATS,
                                    (value) => `dimstyle.angular.${value}` as I18nKeys,
                                ),
                            ],
                            ["dimstyle.field.precision", form.decimals("angularPrecision")],
                        ),
                        checkRow(
                            "dimstyle.group.zeroSuppression",
                            form.check("angularSuppressLeadingZeros", "dimstyle.field.leadingZeros"),
                            form.check("angularSuppressTrailingZeros", "dimstyle.field.trailingZeros"),
                        ),
                    ),
                ),
        },
        {
            caption: "dimstyle.tab.alternateUnits",
            build: () => {
                const on = () => draft.alternateEnabled;
                return div(
                    { className: style.pane },
                    group(
                        "dimstyle.group.alternate",
                        checkRow(
                            undefined,
                            form.check("alternateEnabled", "dimstyle.field.displayAlternate"),
                        ),
                        rows(
                            [
                                "dimstyle.field.precision",
                                form.decimals("alternatePrecision", { enabled: on }),
                            ],
                            [
                                "dimstyle.field.multiplier",
                                form.number("alternateMultiplier", {
                                    step: "0.001",
                                    min: "0.0001",
                                    enabled: on,
                                }),
                            ],
                            [
                                "dimstyle.field.roundDistances",
                                form.number("alternateRoundOff", { step: "0.01", enabled: on }),
                            ],
                            ["dimstyle.field.prefix", form.text("alternatePrefix", { enabled: on })],
                            ["dimstyle.field.suffix", form.text("alternateSuffix", { enabled: on })],
                            [
                                "dimstyle.field.placement",
                                form.choice(
                                    "alternatePlacement",
                                    ALTERNATE_PLACEMENTS,
                                    (value) => `dimstyle.placement.${value}` as I18nKeys,
                                    { enabled: on },
                                ),
                            ],
                        ),
                        checkRow(
                            "dimstyle.group.zeroSuppression",
                            form.check("alternateSuppressLeadingZeros", "dimstyle.field.leadingZeros", {
                                enabled: on,
                            }),
                            form.check("alternateSuppressTrailingZeros", "dimstyle.field.trailingZeros", {
                                enabled: on,
                            }),
                        ),
                    ),
                );
            },
        },
        {
            caption: "dimstyle.tab.tolerances",
            build: () => {
                // "Basic" only draws a box round the measurement, so the values and their
                // formatting have nothing to describe under it - as in AutoCAD.
                const on = () => draft.toleranceMethod !== "none" && draft.toleranceMethod !== "basic";
                // A symmetrical tolerance is one number applied both ways; only the
                // methods with two independent limits enable the lower box.
                const twoSided = () => on() && draft.toleranceMethod !== "symmetrical";
                return div(
                    { className: style.pane },
                    group(
                        "dimstyle.group.toleranceFormat",
                        rows(
                            [
                                "dimstyle.field.method",
                                form.choice(
                                    "toleranceMethod",
                                    TOLERANCE_METHODS,
                                    (value) => `dimstyle.tolerance.${value}` as I18nKeys,
                                ),
                            ],
                            [
                                "dimstyle.field.precision",
                                form.decimals("tolerancePrecision", { enabled: on }),
                            ],
                            [
                                "dimstyle.field.upperValue",
                                form.number("toleranceUpper", { step: "0.01", min: undefined, enabled: on }),
                            ],
                            [
                                "dimstyle.field.lowerValue",
                                form.number("toleranceLower", {
                                    step: "0.01",
                                    min: undefined,
                                    enabled: twoSided,
                                }),
                            ],
                            [
                                "dimstyle.field.scaleForHeight",
                                form.number("toleranceTextScale", { step: "0.05", min: "0.1", enabled: on }),
                            ],
                            [
                                "dimstyle.field.verticalPosition",
                                form.choice(
                                    "toleranceAlignment",
                                    TOLERANCE_ALIGNMENTS,
                                    (value) => `dimstyle.toleranceAlign.${value}` as I18nKeys,
                                    { enabled: twoSided },
                                ),
                            ],
                        ),
                        checkRow(
                            "dimstyle.group.zeroSuppression",
                            form.check("toleranceSuppressLeadingZeros", "dimstyle.field.leadingZeros", {
                                enabled: on,
                            }),
                            form.check("toleranceSuppressTrailingZeros", "dimstyle.field.trailingZeros", {
                                enabled: on,
                            }),
                        ),
                    ),
                );
            },
        },
    ];
}
