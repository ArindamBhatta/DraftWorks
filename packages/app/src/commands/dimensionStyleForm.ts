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
    type ArrowheadType,
    arrowheadSample,
    CENTER_MARK_TYPES,
    type CenterMarkType,
    DECIMAL_SEPARATORS,
    type DecimalSeparator,
    DIMENSION_COLORS,
    DIMENSION_LINE_TYPES,
    DIMENSION_LINE_WEIGHTS,
    type DimensionColor,
    type DimensionLineType,
    type DimensionSettings,
    FIT_OPTIONS,
    I18n,
    type I18nKeys,
    LINE_WEIGHT_BY_BLOCK,
    LINE_WEIGHT_BY_LAYER,
    LINE_WEIGHT_DEFAULT,
    pixelsForLineWeight,
    resolveDimensionLineType,
    TEXT_ALIGNMENTS,
    TEXT_FILL_TYPES,
    TEXT_HORIZONTAL_PLACEMENTS,
    TEXT_VERTICAL_PLACEMENTS,
    TOLERANCE_ALIGNMENTS,
    TOLERANCE_METHODS,
    UnitSetup,
} from "@draftworks/core";
import { button, div, fieldset, input, label, legend, option, select, span } from "@draftworks/element";
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
 * DIMDSEP by name rather than by the character itself - a dropdown row reading " " is
 * blank, and one reading "." is a speck. AutoCAD names all three for the same reason.
 */
const SEPARATOR_LABELS: Record<DecimalSeparator, I18nKeys> = {
    ",": "dimstyle.separator.comma",
    ".": "dimstyle.separator.period",
    " ": "dimstyle.separator.space",
};

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

    /**
     * DIMLTYPE/DIMLTEX1/DIMLTEX2. The dash pattern is drawn beside its name rather than
     * only named, because "Hidden" and "Dashed" mean nothing until you have seen the
     * difference - which is the same reason the layer panel draws its linetype column.
     */
    lineType(key: KeysOf<DimensionLineType>, options?: { enabled?: () => boolean }) {
        return this.picker(
            String(key),
            DIMENSION_LINE_TYPES.map((value) => ({
                value,
                label: translate(`dimstyle.lineType.${value}` as I18nKeys),
                // A fixed width: this row is about the *pattern*, and the lineweight row
                // below it has its own sample for the thickness.
                icon: () => lineSample(value, LINE_WEIGHT_DEFAULT),
            })),
            () => this.draft[key] as string,
            (value) => {
                (this.draft[key] as DimensionLineType) = value as DimensionLineType;
            },
            options,
        );
    }

    /**
     * DIMLWD/DIMLWE. Millimetres, with the three inherited values at the top of the list
     * the way every AutoCAD lineweight dropdown carries them.
     */
    lineWeight(key: NumberKey, options?: { enabled?: () => boolean }) {
        const entries = [
            { value: LINE_WEIGHT_BY_BLOCK, label: translate("dimstyle.lineWeight.byBlock") },
            { value: LINE_WEIGHT_BY_LAYER, label: translate("dimstyle.lineWeight.byLayer") },
            { value: LINE_WEIGHT_DEFAULT, label: translate("dimstyle.lineWeight.default") },
            // Two decimals throughout, as AutoCAD writes them - "0.30 mm", not "0.3 mm".
            ...DIMENSION_LINE_WEIGHTS.map((mm) => ({ value: mm, label: `${mm.toFixed(2)} mm` })),
        ];
        return this.picker(
            String(key),
            entries.map((entry) => ({
                value: String(entry.value),
                label: entry.label,
                icon: () => lineSample("solid", entry.value),
            })),
            () => String(this.draft[key]),
            (value) => {
                (this.draft[key] as number) = Number(value);
            },
            options,
        );
    }

    /**
     * DIMBLK1/DIMBLK2/DIMLDRBLK. Every head is drawn in the list beside its name, because
     * "Closed filled" and "Closed blank" are two words apart and two quite different
     * arrowheads - and only one of those facts survives a text-only dropdown.
     */
    arrowhead(key: KeysOf<ArrowheadType>, options?: { enabled?: () => boolean }) {
        return this.picker(
            String(key),
            ARROWHEAD_TYPES.map((value) => ({
                value,
                label: translate(`dimstyle.arrow.${value}` as I18nKeys),
                icon: () => arrowSample(value),
            })),
            () => this.draft[key] as string,
            (value) => {
                (this.draft[key] as ArrowheadType) = value as ArrowheadType;
            },
            options,
        );
    }

    /**
     * DIMCEN. A cross, a cross with centre lines running out of it, or nothing - three
     * outcomes that are far clearer drawn than named.
     */
    centerMark(key: KeysOf<CenterMarkType>, options?: { enabled?: () => boolean }) {
        return this.picker(
            String(key),
            CENTER_MARK_TYPES.map((value) => ({
                value,
                label: translate(`dimstyle.centerMark.${value}` as I18nKeys),
                icon: () => centerMarkSample(value),
            })),
            () => this.draft[key] as string,
            (value) => {
                (this.draft[key] as CenterMarkType) = value as CenterMarkType;
            },
            options,
        );
    }

    /**
     * A dropdown whose list draws each choice as well as naming it - AutoCAD's own
     * linetype, lineweight and arrowhead pickers, which are lists of pictures with the
     * names beside them.
     *
     * Built by hand rather than from a `<select>`: a native option can hold text and
     * nothing else, so the one thing these settings most need to show - what the choice
     * actually looks like - is the one thing it cannot render. The popup is appended
     * inside the field rather than to `document.body`, because the dialog is opened with
     * `showModal()` and a body-level popup would be painted behind its top layer.
     */
    private picker(
        name: string,
        entries: { value: string; label: string; icon: () => SVGSVGElement }[],
        current: () => string,
        assign: (value: string) => void,
        options?: { enabled?: () => boolean },
    ) {
        const face = div({ className: style.pickerFace });
        const list = div({ className: style.pickerList });

        const redrawFace = () => {
            const chosen = entries.find((entry) => entry.value === current()) ?? entries[0];
            face.replaceChildren(
                chosen.icon(),
                span({ className: style.pickerLabel, textContent: chosen.label }),
                span({ className: style.pickerCaret, textContent: "▾" }),
            );
        };

        // The button carries the setting's key so tests and the DOM can still address a
        // control by what it edits, exactly as the `<select>` it replaces did.
        const field = button({
            className: style.picker,
            name,
            type: "button",
            onclick: (e) => {
                e.stopPropagation();
                field.classList.toggle(style.pickerOpen);
            },
            // Closing on blur rather than on a document listener keeps the whole thing
            // inside the dialog, which is the only place its events reach.
            onblur: () => field.classList.remove(style.pickerOpen),
            onkeydown: (e) => {
                e.stopPropagation();
                if (e.key === "Escape") field.classList.remove(style.pickerOpen);
            },
        });

        for (const entry of entries) {
            const row = div(
                {
                    className: style.pickerItem,
                    // mousedown, not click: blur fires first on a click and would close
                    // the list before the row ever heard about it.
                    onmousedown: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        assign(entry.value);
                        redrawFace();
                        for (const other of list.children) {
                            other.classList.toggle(style.pickerCurrent, other === row || other.contains(row));
                        }
                        field.classList.remove(style.pickerOpen);
                        this.changed();
                    },
                },
                entry.icon(),
                span({ className: style.pickerLabel, textContent: entry.label }),
            );
            if (entry.value === current()) row.classList.add(style.pickerCurrent);
            list.append(row);
        }

        redrawFace();
        field.append(face, list);
        if (options?.enabled) this.gated(field, options.enabled);
        return field;
    }
}

/** The shared SVG canvas every picker sample is drawn on. */
function sampleSvg(): SVGSVGElement {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 48 12");
    svg.classList.add(style.pickerIcon);
    return svg;
}

const NS = "http://www.w3.org/2000/svg";

/** A `<line>` with the attributes every sample sets on it. */
function segment(x1: number, y1: number, x2: number, y2: number, width = 1): SVGLineElement {
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", String(width));
    return line;
}

/** A linetype or lineweight drawn as itself: a line in that pattern, at that width. */
function lineSample(lineType: DimensionLineType, weight: number): SVGSVGElement {
    const svg = sampleSvg();
    // The same mm-to-pixel conversion the viewport uses, so the sample is honest about
    // how thick the line will actually be - capped so the fattest rung still fits.
    const line = segment(1, 6, 47, 6, Math.min(8, pixelsForLineWeight(weight)));
    const dashes: Partial<Record<string, string>> = { dash: "8 5", hidden: "4 4", dot: "1 4" };
    const pattern = dashes[resolveDimensionLineType(lineType)];
    if (pattern) line.setAttribute("stroke-dasharray", pattern);
    svg.append(line);
    return svg;
}

/** How much of the sample one arrowhead takes up, in viewBox units. */
const ARROW_SAMPLE_SIZE = 13;

/**
 * An arrowhead at the left end of a short dimension line - the context it is actually
 * seen in, and what AutoCAD's own list shows.
 *
 * The shape comes from `arrowheadSample` in core, so it is the real arrowhead rather
 * than a drawing of one: change how a head is built and this changes with it.
 */
function arrowSample(type: ArrowheadType): SVGSVGElement {
    const svg = sampleSvg();
    // Tip at the left, head pointing left, with the line running away to the right.
    const tipX = 6;
    const midY = 6;
    const sample = arrowheadSample(type, ARROW_SAMPLE_SIZE);

    // The shaft, from behind the head to the right edge. `none` has no head, so the line
    // runs the whole way and the row still reads as a dimension line.
    svg.append(segment(type === "none" ? tipX : tipX + ARROW_SAMPLE_SIZE * 0.5, midY, 45, midY));

    // Core lays the sample out with the tip at the origin pointing along -X; the sample
    // wants it at `tipX`, with SVG's Y running the other way.
    const px = (x: number) => tipX + x;
    const py = (y: number) => midY - y;

    for (let i = 0; i + 8 < sample.triangles.length; i += 9) {
        const [ax, ay, , bx, by, , cx, cy] = sample.triangles.slice(i, i + 9);
        const tri = document.createElementNS(NS, "path");
        tri.setAttribute("d", `M${px(ax)} ${py(ay)}L${px(bx)} ${py(by)}L${px(cx)} ${py(cy)}Z`);
        tri.setAttribute("fill", "currentColor");
        svg.append(tri);
    }

    for (let i = 0; i + 5 < sample.strokes.length; i += 6) {
        const [ax, ay, , bx, by] = sample.strokes.slice(i, i + 6);
        svg.append(segment(px(ax), py(ay), px(bx), py(by)));
    }

    return svg;
}

/**
 * A center mark inside a reference circle - a mark on its own is just a cross, and what
 * distinguishes "Mark" from "Line" is whether it breaks out of the circle. Mirrors
 * `centerMarkGeometry`: a cross on both axes, plus outer stubs for `line`.
 */
function centerMarkSample(type: CenterMarkType): SVGSVGElement {
    const svg = sampleSvg();
    const cx = 24;
    const cy = 6;
    const radius = 4;

    const circle = document.createElementNS(NS, "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "currentColor");
    circle.setAttribute("stroke-width", "0.7");
    // Dimmed, because the circle is context rather than part of the setting.
    circle.setAttribute("opacity", "0.45");
    svg.append(circle);

    if (type !== "none") {
        const arm = radius * 0.6;
        svg.append(segment(cx - arm, cy, cx + arm, cy), segment(cx, cy - arm, cx, cy + arm));
    }
    if (type === "line") {
        const from = radius + 1.5;
        const to = radius + 4;
        svg.append(
            segment(cx - to, cy, cx - from, cy),
            segment(cx + from, cy, cx + to, cy),
            segment(cx, cy - to, cx, cy - from),
            segment(cx, cy + from, cx, cy + to),
        );
    }

    return svg;
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
                            ["dimstyle.field.linetype", form.lineType("dimLineType")],
                            ["dimstyle.field.lineweight", form.lineWeight("dimLineWeight")],
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
                            ["dimstyle.field.linetypeExt1", form.lineType("extLineType1")],
                            ["dimstyle.field.linetypeExt2", form.lineType("extLineType2")],
                            ["dimstyle.field.lineweight", form.lineWeight("extLineWeight")],
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
                            ["dimstyle.field.first", form.arrowhead("arrowhead1")],
                            ["dimstyle.field.second", form.arrowhead("arrowhead2")],
                            ["dimstyle.field.leader", form.arrowhead("leaderArrowhead")],
                            ["dimstyle.field.arrowSize", form.number("arrowSize")],
                        ),
                    ),
                    group(
                        "dimstyle.group.centerMarks",
                        rows(
                            ["dimstyle.field.type", form.centerMark("centerMark")],
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
                                form.choice(
                                    "decimalSeparator",
                                    DECIMAL_SEPARATORS,
                                    (value) => SEPARATOR_LABELS[value],
                                ),
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
