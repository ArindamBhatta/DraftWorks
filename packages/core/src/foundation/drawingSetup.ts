/**
 * The two drawing-wide settings blocks that follow unit setup in AutoCAD's new-drawing
 * flow (see UnitSetup for the first one):
 *
 * - DimensionSetup is DIMSTYLE's core geometry: how big dimension text and arrowheads
 *   are drawn, how far extension lines stand off the object, and how many decimals a
 *   measurement shows.
 * - MvSetup is MVSETUP: the plot scale and the sheet the drawing is laid out on.
 *
 * Both are drawing-unit based, so they mean whatever the active unit type means - they
 * deliberately do not convert, exactly like AutoCAD's DIMSCALE-free defaults.
 */

import { UnitSetup } from "./unitSetup";

/** Decimals used for quantities a fraction denominator cannot express - see decimalPlaces. */
const DEFAULT_DECIMALS = 2;

export interface DimensionSettings {
    /** Height of dimension text, in drawing units. */
    textHeight: number;
    /** Arrowhead length, in drawing units. */
    arrowSize: number;
    /** Gap between the measured geometry and the start of its extension line. */
    extensionOffset: number;
    /**
     * Precision a measurement is reported to. Same two-meanings-in-one-number as
     * UnitSettings.precision (fraction denominator vs decimal places, depending on the
     * active unit type), which is why it is validated at format time by
     * UnitSetup.formatLength rather than clamped to a decimal range here.
     */
    precision: number;
}

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

const clampPrecision = (value: number, fallback: number) =>
    Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;

export class DimensionSetup {
    // Precision defaults to 1/16", matching UnitSetup's own architectural default, so
    // the two agree before anyone opens either dialog. If the unit type is later
    // changed to a decimal one, UnitSetup.formatLength clamps this at render time and
    // the Dimension Setup dialog re-offers that type's own options.
    private static _settings: DimensionSettings = {
        textHeight: 2.5,
        arrowSize: 2.5,
        extensionOffset: 0.625,
        precision: 16,
    };

    static get settings(): DimensionSettings {
        return { ...DimensionSetup._settings };
    }

    static configure(settings: Partial<DimensionSettings>): void {
        const current = DimensionSetup._settings;
        DimensionSetup._settings = {
            textHeight: clampPositive(settings.textHeight ?? current.textHeight, current.textHeight),
            arrowSize: clampPositive(settings.arrowSize ?? current.arrowSize, current.arrowSize),
            // 0 is a legitimate offset, so this one is not clamped away from zero.
            extensionOffset: Math.max(0, settings.extensionOffset ?? current.extensionOffset),
            precision: clampPrecision(settings.precision ?? current.precision, current.precision),
        };
    }

    /**
     * Formats a measured length for display, in the drawing's unit format and at the
     * dimension precision. Every length a measure command reports goes through here, so
     * changing Dimension Setup or Unit Setup changes what is already on screen the next
     * time it is drawn - rather than each call site inventing its own `toFixed(2)`.
     */
    static formatLength(value: number): string {
        return UnitSetup.formatLength(value, { precision: DimensionSetup._settings.precision });
    }

    /**
     * Decimal places for quantities that are not plain lengths - areas and angles.
     * Feet-and-inches formatting is meaningless for those, and under architectural or
     * fractional units the stored precision is a fraction denominator rather than a
     * count of decimals, so those types fall back to a readable default.
     */
    static decimalPlaces(): number {
        const { precision } = DimensionSetup._settings;
        if (UnitSetup.usesFractionalPrecision(UnitSetup.settings.type)) return DEFAULT_DECIMALS;
        return Math.min(8, precision);
    }

    /** Formats an area or an angle - see decimalPlaces. */
    static formatDecimal(value: number): string {
        return value.toFixed(DimensionSetup.decimalPlaces());
    }
}

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
