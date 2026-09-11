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
    validateDimensionSettings,
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

/** localStorage key holding the dimension settings between sessions. */
const DIMENSION_STORAGE_KEY = "dimensionSetup";

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

export class DimensionSetup {
    private static _settings: DimensionSettings = { ...DEFAULT_DIMENSION_SETTINGS };

    /** See UnitSetup.isRestored - lets start-up skip re-asking a returning user. */
    static #restored = false;
    static get isRestored(): boolean {
        return DimensionSetup.#restored;
    }

    /** Load the settings saved by the last session. See UnitSetup.restore. */
    static restore(): boolean {
        const saved = ObjectStorage.default.value<Partial<DimensionSettings>>(DIMENSION_STORAGE_KEY);
        if (saved?.textHeight === undefined) return false;

        // Restoring replaces the style rather than patching the live one, so anything the
        // saved copy is missing or has wrong comes back as its *default* - not as whatever
        // happened to be set in this session. That matters because a style written by an
        // older build is missing every setting added since, and folding it onto the live
        // settings would have quietly kept those instead.
        DimensionSetup._settings = validateDimensionSettings(saved, DEFAULT_DIMENSION_SETTINGS);
        // Written straight back so the stored copy is migrated in place, and the next
        // session reads a complete style rather than repeating this repair.
        ObjectStorage.default.setValue(DIMENSION_STORAGE_KEY, DimensionSetup._settings);
        DimensionSetup.#restored = true;
        return true;
    }

    static get settings(): DimensionSettings {
        return { ...DimensionSetup._settings };
    }

    /**
     * The active settings with `overrides` applied on top, without storing anything.
     *
     * This is what lets the Dimension Setup dialog preview settings the user has typed
     * but not confirmed yet: the real geometry builder lays the sample dimensions out
     * through these, so the preview cannot drift from what the drawing will do. Mirrors
     * the `Partial<UnitSettings>` argument UnitSetup.formatLength already takes.
     */
    static resolve(overrides?: Partial<DimensionSettings>): DimensionSettings {
        return { ...DimensionSetup._settings, ...overrides };
    }

    static configure(settings: Partial<DimensionSettings>): void {
        DimensionSetup._settings = validateDimensionSettings(settings, DimensionSetup._settings);
        ObjectStorage.default.setValue(DIMENSION_STORAGE_KEY, DimensionSetup._settings);
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
            precision: precision ?? DimensionSetup._settings.precision,
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
        const resolved = precision ?? DimensionSetup._settings.precision;
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
