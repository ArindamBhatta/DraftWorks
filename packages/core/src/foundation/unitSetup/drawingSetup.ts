/**
 * The two drawing-wide settings blocks that sit alongside unit setup (see UnitSetup):
 *
 * - DimensionSetup is DIMSTYLE: the whole dimension style, from line and arrowhead
 *   geometry through text placement to how a measurement is written and toleranced. The
 *   settings themselves live in `dimensionStyle`, one block per tab of the dialog; this
 *   class is what holds the active one and persists it. Live - read by dimensionGeometry,
 *   dimensionText, the renderer, annotations and text.
 * - MvSetup is MVSETUP: the plot scale and the sheet the drawing is laid out on.
 *   **Groundwork, not a live setting** - see the note on the class.
 *
 * Both are drawing-unit based, so they mean whatever the active unit type means - sizes
 * deliberately do not convert, and are scaled only by the style's own DIMSCALE.
 */

import { ObjectStorage } from "../objectStorage";
import {
    DEFAULT_DIMENSION_SETTINGS,
    type DimensionSettings,
    isStandardStyle,
    STANDARD_STYLE_NAME,
    sameStyleName,
    uniqueStyleName,
    validateDimensionSettings,
    validateStyleName,
} from "./dimensionStyle";
import {
    type DimensionLabel,
    flattenDimensionLabel,
    formatDimensionLabel,
    type MeasurementKind,
} from "./dimensionText";
import { UnitSetup } from "./unitSetup";

/** Decimals used for quantities a fraction denominator cannot express - see decimalPlaces. */
const DEFAULT_DECIMALS = 2;

/**
 * localStorage key holding the dimension *style table* between sessions.
 *
 * Deliberately not the old `dimensionSetup` key, which held a single bare
 * `DimensionSettings`. Writing a table into that key would have been read back as a style
 * by any older build still installed, and read as a table here; a new key lets `restore`
 * recognise which of the two it is looking at and migrate - see `restore`.
 */
const DIMENSION_STORAGE_KEY = "dimensionStyles";

/** The pre-style-table key, read once on restore and then left alone. See `restore`. */
const LEGACY_DIMENSION_STORAGE_KEY = "dimensionSetup";

/** The shape written to localStorage: every style, plus which one is current. */
interface DimensionStyleTable {
    current: string;
    styles: DimensionSettings[];
}

/**
 * Settings applied on top of the current style without being saved into it - AutoCAD's
 * style *override*. Cleared by setting a style current, as AutoCAD does.
 */
type StyleOverride = Partial<DimensionSettings> | undefined;

/** Named sheets MVSETUP offers, sized in millimetres. */
export const PAPER_SIZES = {
    A4: { width: 297, height: 210 },
    A3: { width: 420, height: 297 },
    A2: { width: 594, height: 420 },
    A1: { width: 841, height: 594 },
    A0: { width: 1189, height: 841 },
    Letter: { width: 279.4, height: 215.9 },
    Tabloid: { width: 431.8, height: 279.4 },
} as const;

export type PaperSizeName = keyof typeof PAPER_SIZES | "Custom";

export interface MvSettings {
    /** Plot scale as a ratio of drawing units to paper units (1 = 1:1). */
    scale: number;
    paperSize: PaperSizeName;
    /** Sheet size in millimetres; tracks paperSize unless it is "Custom". */
    paperWidth: number;
    paperHeight: number;
}

const clampPositive = (value: number, fallback: number) =>
    Number.isFinite(value) && value > 0 ? value : fallback;

/**
 * DIMSTYLE: the drawing's dimension style *table* - every named style, which one is
 * current, and the unsaved override sitting on top of it.
 *
 * A dimension resolves its style by name (`styleFor`), falling back to the current style
 * when it names none or names one that has since been deleted. Nothing here can leave a
 * dimension unrenderable: every lookup ends at a real style, and the table always holds
 * at least Standard.
 */
export class DimensionSetup {
    /** Keyed by lower-cased name, since style names compare case-insensitively. */
    private static _styles = new Map<string, DimensionSettings>([
        [STANDARD_STYLE_NAME.toLowerCase(), { ...DEFAULT_DIMENSION_SETTINGS }],
    ]);

    private static _current = STANDARD_STYLE_NAME;

    /**
     * The current style's unsaved override, or undefined. Not persisted: AutoCAD drops a
     * style override when the drawing closes unless it was saved into a style, and a
     * silently reloaded override is the kind of state that makes a drawing look wrong for
     * no visible reason.
     */
    private static _override: StyleOverride;

    /** See UnitSetup.isRestored - lets start-up skip re-asking a returning user. */
    static #restored = false;
    static get isRestored(): boolean {
        return DimensionSetup.#restored;
    }

    /**
     * Load the style table saved by the last session. See UnitSetup.restore.
     *
     * Also migrates the single style written by builds before the style table existed:
     * that style becomes Standard and current, so a returning user's dimensions come back
     * looking exactly as they left - see `LEGACY_DIMENSION_STORAGE_KEY`.
     */
    static restore(): boolean {
        const table = ObjectStorage.default.value<Partial<DimensionStyleTable>>(DIMENSION_STORAGE_KEY);
        const saved = Array.isArray(table?.styles) ? table.styles : undefined;
        if (saved !== undefined) {
            DimensionSetup.load(saved, table?.current);
            DimensionSetup.#restored = true;
            return true;
        }

        const legacy = ObjectStorage.default.value<Partial<DimensionSettings>>(LEGACY_DIMENSION_STORAGE_KEY);
        if (legacy?.textHeight === undefined) return false;

        // The one pre-table style, whatever it was called (it was called nothing), is
        // Standard now. Forced rather than validated through, because the legacy style
        // has no name at all and validateDimensionSettings would leave it as the default
        // anyway - being explicit says which of the two is happening.
        DimensionSetup.load([{ ...legacy, name: STANDARD_STYLE_NAME }], STANDARD_STYLE_NAME);
        DimensionSetup.#restored = true;
        return true;
    }

    /**
     * Replaces the table with `styles`, repairing whatever is wrong with it: styles are
     * validated against the *defaults* rather than against the live table, so a style
     * written by an older build gains the settings it never had as defaults rather than
     * inheriting them from whichever style happens to be loaded (the same rule the
     * pre-table `restore` followed, and for the same reason).
     *
     * Duplicate names collapse onto the first, unnamed styles are dropped, and a table
     * with no usable style at all falls back to a fresh Standard, so the invariant that
     * there is always something to draw in holds however damaged the input was.
     */
    private static load(styles: readonly Partial<DimensionSettings>[], current?: string): void {
        const loaded = new Map<string, DimensionSettings>();
        for (const style of styles) {
            const validated = validateDimensionSettings(style, DEFAULT_DIMENSION_SETTINGS);
            // A style whose name did not survive validation would land on the default
            // name and quietly overwrite Standard, so it is dropped instead.
            if (typeof style.name !== "string" || validateStyleName(style.name, []) !== undefined) {
                continue;
            }
            const key = validated.name.toLowerCase();
            if (!loaded.has(key)) loaded.set(key, validated);
        }

        if (!loaded.has(STANDARD_STYLE_NAME.toLowerCase())) {
            loaded.set(STANDARD_STYLE_NAME.toLowerCase(), { ...DEFAULT_DIMENSION_SETTINGS });
        }

        DimensionSetup._styles = loaded;
        DimensionSetup._override = undefined;
        DimensionSetup._current =
            current !== undefined && loaded.has(current.toLowerCase())
                ? (loaded.get(current.toLowerCase())?.name ?? STANDARD_STYLE_NAME)
                : STANDARD_STYLE_NAME;
        DimensionSetup.save();
    }

    private static save(): void {
        ObjectStorage.default.setValue(DIMENSION_STORAGE_KEY, {
            current: DimensionSetup._current,
            styles: [...DimensionSetup._styles.values()],
        });
    }

    /** Every style in the table, in name order - what the manager's list shows. */
    static get styles(): DimensionSettings[] {
        return [...DimensionSetup._styles.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    /** Every style's name, for the uniqueness checks in `validateStyleName`. */
    static get styleNames(): string[] {
        return DimensionSetup.styles.map((style) => style.name);
    }

    /** The current style's name. */
    static get currentStyleName(): string {
        return DimensionSetup._current;
    }

    /** True when unsaved overrides are sitting on top of the current style. */
    static get hasOverride(): boolean {
        return DimensionSetup._override !== undefined;
    }

    /** The current override, for the manager's Override button to open on. */
    static get override(): Partial<DimensionSettings> | undefined {
        return DimensionSetup._override === undefined ? undefined : { ...DimensionSetup._override };
    }

    /**
     * The settings in force for new dimensions: the current style with any override
     * folded in. This is what `settings` has always meant, so every existing caller keeps
     * working - it just now has a table behind it.
     */
    static get settings(): DimensionSettings {
        const base = DimensionSetup._styles.get(DimensionSetup._current.toLowerCase());
        return { ...(base ?? DEFAULT_DIMENSION_SETTINGS), ...DimensionSetup._override };
    }

    /** One style by name, or undefined if the table has no such style. */
    static style(name: string): DimensionSettings | undefined {
        const found = DimensionSetup._styles.get(name.toLowerCase());
        return found === undefined ? undefined : { ...found };
    }

    /**
     * The settings a dimension should be drawn with.
     *
     * A dimension naming no style takes the current one, which is what makes an override
     * show up on new dimensions. A dimension naming a style that is *gone* also takes the
     * current one rather than failing to draw: the manager will not delete a style that
     * is in use, but a DXF from elsewhere can name a style this drawing never had.
     */
    static styleFor(styleName?: string): DimensionSettings {
        if (styleName === undefined) return DimensionSetup.settings;
        const found = DimensionSetup._styles.get(styleName.toLowerCase());
        return found === undefined ? DimensionSetup.settings : { ...found };
    }

    /**
     * The active settings with `overrides` applied on top, without storing anything.
     *
     * This is what lets the Dimension Style dialog preview settings the user has typed
     * but not confirmed yet: the real geometry builder lays the sample dimensions out
     * through these, so the preview cannot drift from what the drawing will do. Mirrors
     * the `Partial<UnitSettings>` argument UnitSetup.formatLength already takes.
     */
    static resolve(overrides?: Partial<DimensionSettings>): DimensionSettings {
        return { ...DimensionSetup.settings, ...overrides };
    }

    /**
     * Writes `settings` into the current style - the Modify button, and what every
     * pre-style-table caller of this method meant.
     */
    static configure(settings: Partial<DimensionSettings>): void {
        DimensionSetup.modify(DimensionSetup._current, settings);
    }

    /**
     * Writes `settings` into the named style. Renaming through here is honoured (and
     * re-points `current` if it was the current style), except for Standard, whose name
     * is fixed.
     */
    static modify(name: string, settings: Partial<DimensionSettings>): void {
        const key = name.toLowerCase();
        const existing = DimensionSetup._styles.get(key);
        if (existing === undefined) return;

        const renameTo =
            typeof settings.name === "string" &&
            !isStandardStyle(existing.name) &&
            validateStyleName(settings.name, DimensionSetup.styleNames, existing.name) === undefined
                ? settings.name.trim()
                : existing.name;

        const updated = validateDimensionSettings({ ...settings, name: renameTo }, existing);

        // Rebuilt rather than mutated in place so a rename keeps the table's order, which
        // is the order the manager's list was showing when the rename was typed.
        const rebuilt = new Map<string, DimensionSettings>();
        for (const [otherKey, style] of DimensionSetup._styles) {
            if (otherKey === key) rebuilt.set(updated.name.toLowerCase(), updated);
            else rebuilt.set(otherKey, style);
        }
        DimensionSetup._styles = rebuilt;

        if (sameStyleName(DimensionSetup._current, existing.name)) {
            DimensionSetup._current = updated.name;
        }
        DimensionSetup.save();
    }

    /**
     * Adds a style copied from `basedOn` (the current style by default) under a name the
     * table does not already hold, and returns that name. The manager's New button.
     */
    static createStyle(name: string, basedOn?: string): string {
        const parent = DimensionSetup.styleFor(basedOn ?? DimensionSetup._current);
        const requested = name.trim();
        const usable =
            validateStyleName(requested, DimensionSetup.styleNames) === undefined
                ? requested
                : uniqueStyleName(parent.name, DimensionSetup.styleNames);

        DimensionSetup._styles.set(usable.toLowerCase(), { ...parent, name: usable });
        DimensionSetup.save();
        return usable;
    }

    /**
     * Makes `name` the current style, dropping any override - as AutoCAD does, where
     * setting a style current is the way to discard one.
     */
    static setCurrent(name: string): boolean {
        const found = DimensionSetup._styles.get(name.toLowerCase());
        if (found === undefined) return false;

        DimensionSetup._current = found.name;
        DimensionSetup._override = undefined;
        DimensionSetup.save();
        return true;
    }

    /**
     * Deletes a style. Standard and the current style both refuse - AutoCAD will not let
     * you delete either, and refusing here is what lets `styleFor` treat a missing style
     * as an import artefact rather than something this app can cause.
     */
    static deleteStyle(name: string): boolean {
        if (isStandardStyle(name) || sameStyleName(name, DimensionSetup._current)) return false;
        if (!DimensionSetup._styles.delete(name.toLowerCase())) return false;

        DimensionSetup.save();
        return true;
    }

    /**
     * Sets or clears the current style's override. Passing undefined clears it, as does
     * an override that differs from the style in nothing.
     */
    static setOverride(overrides: Partial<DimensionSettings> | undefined): void {
        if (overrides === undefined) {
            DimensionSetup._override = undefined;
            return;
        }

        const base = DimensionSetup._styles.get(DimensionSetup._current.toLowerCase());
        const differing: Partial<DimensionSettings> = {};
        for (const [key, value] of Object.entries(overrides) as [
            keyof DimensionSettings,
            DimensionSettings[keyof DimensionSettings],
        ][]) {
            // The name is the style's identity, not one of its settings - an override
            // that renamed the style would be a rename wearing a disguise.
            if (key === "name") continue;
            if (base !== undefined && base[key] === value) continue;
            Object.assign(differing, { [key]: value });
        }

        DimensionSetup._override = Object.keys(differing).length === 0 ? undefined : differing;
    }

    /** Folds the override into the current style and clears it - Override's Save As. */
    static saveOverrideToStyle(): void {
        if (DimensionSetup._override === undefined) return;

        const override = DimensionSetup._override;
        DimensionSetup._override = undefined;
        DimensionSetup.modify(DimensionSetup._current, override);
    }

    /**
     * The settings two styles disagree on - the Compare button. Keyed by setting, with
     * both values, so the dialog can table them without re-reading either style.
     */
    static compare(
        first: string,
        second: string,
    ): { key: keyof DimensionSettings; first: unknown; second: unknown }[] {
        const a = DimensionSetup.styleFor(first);
        const b = DimensionSetup.styleFor(second);
        const differences: { key: keyof DimensionSettings; first: unknown; second: unknown }[] = [];
        for (const key of Object.keys(a) as (keyof DimensionSettings)[]) {
            // Two styles always differ by name; saying so is noise, not a difference.
            if (key === "name") continue;
            if (a[key] !== b[key]) differences.push({ key, first: a[key], second: b[key] });
        }
        return differences;
    }

    /**
     * Formats a measured length for display, in the drawing's unit format and at the
     * dimension precision. Every length a measure command reports goes through here, so
     * changing Dimension Setup or Unit Setup changes what is already on screen the next
     * time it is drawn - rather than each call site inventing its own `toFixed(2)`.
     *
     * This is the bare number only. A *dimension's* label goes through `label()` instead,
     * which adds the affixes, alternate units and tolerance the style also asks for.
     */
    static formatLength(value: number, precision?: number): string {
        return UnitSetup.formatLength(value, {
            precision: precision ?? DimensionSetup.settings.precision,
        });
    }

    /**
     * The full label for a measurement under the active style (or `overrides`, for the
     * setup dialog's preview) - see `formatDimensionLabel`.
     */
    static label(
        value: number,
        kind: MeasurementKind = "length",
        typePrefix = "",
        overrides?: Partial<DimensionSettings>,
    ): DimensionLabel {
        return formatDimensionLabel(value, DimensionSetup.resolve(overrides), kind, typePrefix);
    }

    /** The same label as one plain string - see `flattenDimensionLabel`. */
    static labelText(
        value: number,
        kind: MeasurementKind = "length",
        typePrefix = "",
        overrides?: Partial<DimensionSettings>,
    ): string {
        return flattenDimensionLabel(DimensionSetup.label(value, kind, typePrefix, overrides));
    }

    /**
     * Decimal places for quantities that are not plain lengths - areas and angles.
     * Feet-and-inches formatting is meaningless for those, and under architectural or
     * fractional units the stored precision is a fraction denominator rather than a
     * count of decimals, so those types fall back to a readable default.
     */
    static decimalPlaces(precision?: number): number {
        const resolved = precision ?? DimensionSetup.settings.precision;
        if (UnitSetup.usesFractionalPrecision(UnitSetup.settings.type)) return DEFAULT_DECIMALS;
        return Math.min(8, resolved);
    }

    /** Formats an area or an angle - see decimalPlaces. */
    static formatDecimal(value: number, precision?: number): string {
        return value.toFixed(DimensionSetup.decimalPlaces(precision));
    }
}

/**
 * Plot scale and sheet size - kept as groundwork for a future plot/export feature.
 *
 * NOTHING READS THIS YET. There was an MV Setup dialog that wrote to it as the third step
 * of the new-drawing flow, but no viewport, exporter or layout ever read it back, so
 * confirming a scale of 1:50 on A3 changed nothing about the drawing. The dialog was
 * removed rather than left to imply otherwise; the model stays because the numbers and
 * the sheet table are worth keeping for whenever plotting is actually built.
 *
 * If you are implementing plotting: read from here, and add the UI back against that
 * implementation rather than restoring the old dialog (`git log -- packages/app/src/
 * commands/mvSetupCommand.ts` has it).
 */
export class MvSetup {
    private static _settings: MvSettings = {
        scale: 1,
        paperSize: "A4",
        paperWidth: PAPER_SIZES.A4.width,
        paperHeight: PAPER_SIZES.A4.height,
    };

    static get settings(): MvSettings {
        return { ...MvSetup._settings };
    }

    static configure(settings: Partial<MvSettings>): void {
        const current = MvSetup._settings;
        const paperSize = settings.paperSize ?? current.paperSize;
        // A named size owns its dimensions; only "Custom" takes them from the caller.
        const named = paperSize === "Custom" ? undefined : PAPER_SIZES[paperSize];
        MvSetup._settings = {
            scale: clampPositive(settings.scale ?? current.scale, current.scale),
            paperSize,
            paperWidth: clampPositive(
                named?.width ?? settings.paperWidth ?? current.paperWidth,
                current.paperWidth,
            ),
            paperHeight: clampPositive(
                named?.height ?? settings.paperHeight ?? current.paperHeight,
                current.paperHeight,
            ),
        };
    }
}
