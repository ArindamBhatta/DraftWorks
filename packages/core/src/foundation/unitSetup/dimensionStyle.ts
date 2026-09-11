/**
 * The dimension style model behind the DIMSTYLE dialog - the settings themselves, their
 * defaults, and the validation `DimensionSetup.configure` runs them through.
 *
 * Organised in the order AutoCAD's Modify Dimension Style dialog puts them, one block per
 * tab (Lines, Symbols and Arrows, Text, Fit, Primary Units, Alternate Units, Tolerances),
 * with the DIM* system variable each field corresponds to named in its comment so the
 * dialog, this model and AutoCAD's documentation can be read against each other.
 *
 * Every field here is live: it is read by `buildDimensionGeometry`, `formatDimensionText`
 * or the dimension renderer. AutoCAD settings that would have nothing to act on in this
 * app are deliberately absent rather than present and inert - there is no DIMBASELINE
 * command, so no baseline spacing; no jogged-radius or arc-length dimension, so no jog
 * angle or arc symbol; no text style table, so no text style picker.
 */

/**
 * Arrowhead shapes, by AutoCAD's names. `closedFilled` is the default solid triangle;
 * `architecturalTick` and `oblique` are the slashes used on architectural drawings;
 * `open`, `openReversed` and `right` are stroked rather than filled.
 */
export const ARROWHEAD_TYPES = [
    "closedFilled",
    "closedBlank",
    "closed",
    "dot",
    "architecturalTick",
    "oblique",
    "open",
    "openReversed",
    "right",
    "none",
] as const;
export type ArrowheadType = (typeof ARROWHEAD_TYPES)[number];

/** DIMTAD: where the text sits relative to the dimension line. */
export const TEXT_VERTICAL_PLACEMENTS = ["centered", "above", "outside", "below"] as const;
export type TextVerticalPlacement = (typeof TEXT_VERTICAL_PLACEMENTS)[number];

/** DIMJUST: where the text sits along the dimension line. */
export const TEXT_HORIZONTAL_PLACEMENTS = ["centered", "atExt1", "atExt2"] as const;
export type TextHorizontalPlacement = (typeof TEXT_HORIZONTAL_PLACEMENTS)[number];

/** DIMTIH/DIMTOH: whether the text follows the dimension line's angle or stays upright. */
export const TEXT_ALIGNMENTS = ["horizontal", "aligned", "iso"] as const;
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number];

/** DIMCEN: the mark drawn at the centre of a circle a radius/diameter dimension measures. */
export const CENTER_MARK_TYPES = ["none", "mark", "line"] as const;
export type CenterMarkType = (typeof CENTER_MARK_TYPES)[number];

/**
 * DIMATFIT/DIMTIX: what gets moved outside the extension lines when the measurement is
 * too tight to hold both the text and the arrowheads.
 */
export const FIT_OPTIONS = ["either", "arrows", "text", "both", "textAlways"] as const;
export type FitOption = (typeof FIT_OPTIONS)[number];

/** DIMAUNIT: how an angular measurement is written. */
export const ANGULAR_FORMATS = ["decimalDegrees", "degreesMinutesSeconds", "gradians", "radians"] as const;
export type AngularFormat = (typeof ANGULAR_FORMATS)[number];

/** DIMPOST placement for the alternate measurement: beside the primary, or under it. */
export const ALTERNATE_PLACEMENTS = ["after", "below"] as const;
export type AlternatePlacement = (typeof ALTERNATE_PLACEMENTS)[number];

/** DIMTOL/DIMLIM/DIMGAP: how a tolerance is expressed, if at all. */
export const TOLERANCE_METHODS = ["none", "symmetrical", "deviation", "limits", "basic"] as const;
export type ToleranceMethod = (typeof TOLERANCE_METHODS)[number];

/** DIMTOLJ: which line of a stacked tolerance lines up with the measurement. */
export const TOLERANCE_ALIGNMENTS = ["top", "middle", "bottom"] as const;
export type ToleranceAlignment = (typeof TOLERANCE_ALIGNMENTS)[number];

/**
 * AutoCAD's first seven index colours plus the two inherited values, which is the whole
 * of what its Color dropdowns offer before "Select Color...". `byBlock` and `byLayer`
 * both mean "whatever the dimension would have been drawn in", which for this app is the
 * renderer's own dimension colour - they are kept distinct only so a drawing round-trips
 * through DXF with the author's choice intact.
 */
export const DIMENSION_COLORS = {
    byBlock: undefined,
    byLayer: undefined,
    red: "#ff0000",
    yellow: "#ffff00",
    green: "#00ff00",
    cyan: "#00ffff",
    blue: "#0000ff",
    magenta: "#ff00ff",
    white: "#ffffff",
} as const;
export type DimensionColor = keyof typeof DIMENSION_COLORS;

/** The concrete colour a setting names, or undefined for the renderer's own default. */
export const resolveDimensionColor = (color: DimensionColor): string | undefined => DIMENSION_COLORS[color];

/** DIMTFILL: no fill, or a solid box behind the text in the given colour. */
export const TEXT_FILL_TYPES = ["none", "background", "color"] as const;
export type TextFillType = (typeof TEXT_FILL_TYPES)[number];

export interface DimensionSettings {
    // ---- Lines --------------------------------------------------------------------
    /** DIMCLRD. */
    dimLineColor: DimensionColor;
    /** DIMLWD, in pixels - the renderer's line width, not a plotted lineweight. */
    dimLineWeight: number;
    /** DIMDLE: how far the dimension line runs past the extension lines. */
    dimLineExtend: number;
    /** DIMSD1/DIMSD2: drop the first/second half of the dimension line. */
    suppressDimLine1: boolean;
    suppressDimLine2: boolean;
    /** DIMCLRE. */
    extLineColor: DimensionColor;
    /** DIMLWE, in pixels. */
    extLineWeight: number;
    /** DIMEXE: how far an extension line runs past the dimension line. */
    extensionBeyondDimLine: number;
    /** DIMEXO: gap between the measured geometry and the start of its extension line. */
    extensionOffset: number;
    /** DIMSE1/DIMSE2: drop the first/second extension line. */
    suppressExtLine1: boolean;
    suppressExtLine2: boolean;
    /** DIMFXLON: measure extension lines back from the dimension line, not from the object. */
    fixedExtensionLength: boolean;
    /** DIMFXL: the length used when fixedExtensionLength is on. */
    extensionLength: number;

    // ---- Symbols and Arrows -------------------------------------------------------
    /** DIMBLK1/DIMBLK2/DIMLDRBLK. */
    arrowhead1: ArrowheadType;
    arrowhead2: ArrowheadType;
    leaderArrowhead: ArrowheadType;
    /** DIMASZ. */
    arrowSize: number;
    /** DIMCEN, as a type plus a size rather than AutoCAD's signed single number. */
    centerMark: CenterMarkType;
    centerMarkSize: number;

    // ---- Text ---------------------------------------------------------------------
    /** DIMTXT. */
    textHeight: number;
    /** DIMCLRT. */
    textColor: DimensionColor;
    /** DIMTFILL/DIMTFILLCLR. */
    textFill: TextFillType;
    textFillColor: DimensionColor;
    /** DIMTAD. */
    textVertical: TextVerticalPlacement;
    /** DIMJUST. */
    textHorizontal: TextHorizontalPlacement;
    /** DIMGAP: gap between the dimension line and the text, in drawing units. */
    textOffset: number;
    /** DIMTIH/DIMTOH. */
    textAlignment: TextAlignment;

    // ---- Fit ----------------------------------------------------------------------
    /** DIMATFIT/DIMTIX. */
    fit: FitOption;
    /**
     * DIMSCALE: multiplies every size in this style - text, arrows, offsets and gaps -
     * without touching the measurement itself. The one setting that makes a style usable
     * at a different drawing scale.
     */
    overallScale: number;
    /** DIMTOFL: keep the dimension line between the extension lines even when text is outside. */
    drawDimLineBetweenExtLines: boolean;

    // ---- Primary Units ------------------------------------------------------------
    /**
     * DIMDEC. Same two-meanings-in-one-number as UnitSettings.precision (a fraction
     * denominator under architectural/fractional units, decimal places otherwise), which
     * is why it is validated at format time by UnitSetup.formatLength rather than clamped
     * to a decimal range here.
     */
    precision: number;
    /** DIMDSEP: the character standing in for the decimal point. */
    decimalSeparator: string;
    /** DIMRND: round every measurement to this increment; 0 disables rounding. */
    roundOff: number;
    /** DIMPOST: text placed before/after the measurement. */
    prefix: string;
    suffix: string;
    /** DIMLFAC: multiplies the measured value before it is formatted. */
    measurementScale: number;
    /** DIMZIN. */
    suppressLeadingZeros: boolean;
    suppressTrailingZeros: boolean;
    /** DIMAUNIT/DIMADEC/DIMAZIN - angular dimensions format independently of lengths. */
    angularFormat: AngularFormat;
    angularPrecision: number;
    angularSuppressLeadingZeros: boolean;
    angularSuppressTrailingZeros: boolean;

    // ---- Alternate Units ----------------------------------------------------------
    /** DIMALT. */
    alternateEnabled: boolean;
    /** DIMALTF: drawing units to alternate units, e.g. 25.4 for inches to millimetres. */
    alternateMultiplier: number;
    /** DIMALTD, in decimal places - alternate units are always written decimally. */
    alternatePrecision: number;
    /** DIMALTRND. */
    alternateRoundOff: number;
    /** DIMAPOST. */
    alternatePrefix: string;
    alternateSuffix: string;
    alternatePlacement: AlternatePlacement;
    /** DIMALTZ. */
    alternateSuppressLeadingZeros: boolean;
    alternateSuppressTrailingZeros: boolean;

    // ---- Tolerances ---------------------------------------------------------------
    /** DIMTOL/DIMLIM. */
    toleranceMethod: ToleranceMethod;
    /** DIMTDEC, in decimal places. */
    tolerancePrecision: number;
    /** DIMTP/DIMTM. */
    toleranceUpper: number;
    toleranceLower: number;
    /** DIMTFAC: tolerance text height as a fraction of the measurement's. */
    toleranceTextScale: number;
    /** DIMTOLJ. */
    toleranceAlignment: ToleranceAlignment;
    /** DIMTZIN. */
    toleranceSuppressLeadingZeros: boolean;
    toleranceSuppressTrailingZeros: boolean;
}

/**
 * The style a new drawing starts in.
 *
 * Precision defaults to 1/16", matching UnitSetup's own architectural default, so the two
 * agree before anyone opens either dialog. If the unit type is later changed to a decimal
 * one, UnitSetup.formatLength clamps this at render time and the dialog re-offers that
 * type's own options.
 */
export const DEFAULT_DIMENSION_SETTINGS: DimensionSettings = {
    dimLineColor: "byBlock",
    dimLineWeight: 1,
    dimLineExtend: 0,
    suppressDimLine1: false,
    suppressDimLine2: false,
    extLineColor: "byBlock",
    extLineWeight: 1,
    extensionBeyondDimLine: 1.25,
    extensionOffset: 0.625,
    suppressExtLine1: false,
    suppressExtLine2: false,
    fixedExtensionLength: false,
    extensionLength: 1,

    arrowhead1: "closedFilled",
    arrowhead2: "closedFilled",
    leaderArrowhead: "closedFilled",
    arrowSize: 2.5,
    centerMark: "mark",
    centerMarkSize: 2.5,

    textHeight: 2.5,
    textColor: "byBlock",
    textFill: "none",
    textFillColor: "white",
    textVertical: "above",
    textHorizontal: "centered",
    textOffset: 0.625,
    textAlignment: "aligned",

    fit: "either",
    overallScale: 1,
    drawDimLineBetweenExtLines: true,

    precision: 16,
    decimalSeparator: ".",
    roundOff: 0,
    prefix: "",
    suffix: "",
    measurementScale: 1,
    suppressLeadingZeros: false,
    suppressTrailingZeros: false,
    angularFormat: "decimalDegrees",
    angularPrecision: 2,
    angularSuppressLeadingZeros: false,
    angularSuppressTrailingZeros: false,

    alternateEnabled: false,
    alternateMultiplier: 25.4,
    alternatePrecision: 2,
    alternateRoundOff: 0,
    alternatePrefix: "",
    alternateSuffix: "",
    alternatePlacement: "after",
    alternateSuppressLeadingZeros: false,
    alternateSuppressTrailingZeros: false,

    toleranceMethod: "none",
    tolerancePrecision: 2,
    toleranceUpper: 0,
    toleranceLower: 0,
    toleranceTextScale: 1,
    toleranceAlignment: "middle",
    // Trailing zeros are kept on tolerances by default, as DIMTZIN does: on an engineering
    // drawing the number of decimals is itself information, so `+0.50` and `+0.5` do not
    // say the same thing.
    toleranceSuppressLeadingZeros: false,
    toleranceSuppressTrailingZeros: false,
};

const positive = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;

const nonNegative = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;

const finite = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

const decimals = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value)
        ? Math.min(8, Math.max(0, Math.round(value)))
        : fallback;

const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

const text = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);

/** A value that must come from a fixed list, e.g. an arrowhead name or a placement. */
const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
    options.includes(value as T) ? (value as T) : fallback;

const COLOR_NAMES = Object.keys(DIMENSION_COLORS) as DimensionColor[];

/**
 * Folds `settings` onto `current`, dropping anything malformed rather than letting it
 * through. Every field is checked, because these come back from localStorage as well as
 * from the dialog: a style saved by an older build is missing fields a newer one expects,
 * and a hand-edited one can hold anything at all.
 */
export function validateDimensionSettings(
    settings: Partial<DimensionSettings>,
    current: DimensionSettings = DEFAULT_DIMENSION_SETTINGS,
): DimensionSettings {
    return {
        dimLineColor: oneOf(COLOR_NAMES, settings.dimLineColor, current.dimLineColor),
        dimLineWeight: positive(settings.dimLineWeight, current.dimLineWeight),
        dimLineExtend: nonNegative(settings.dimLineExtend, current.dimLineExtend),
        suppressDimLine1: flag(settings.suppressDimLine1, current.suppressDimLine1),
        suppressDimLine2: flag(settings.suppressDimLine2, current.suppressDimLine2),
        extLineColor: oneOf(COLOR_NAMES, settings.extLineColor, current.extLineColor),
        extLineWeight: positive(settings.extLineWeight, current.extLineWeight),
        extensionBeyondDimLine: nonNegative(settings.extensionBeyondDimLine, current.extensionBeyondDimLine),
        // 0 is a legitimate offset, so this one is not clamped away from zero.
        extensionOffset: nonNegative(settings.extensionOffset, current.extensionOffset),
        suppressExtLine1: flag(settings.suppressExtLine1, current.suppressExtLine1),
        suppressExtLine2: flag(settings.suppressExtLine2, current.suppressExtLine2),
        fixedExtensionLength: flag(settings.fixedExtensionLength, current.fixedExtensionLength),
        extensionLength: positive(settings.extensionLength, current.extensionLength),

        arrowhead1: oneOf(ARROWHEAD_TYPES, settings.arrowhead1, current.arrowhead1),
        arrowhead2: oneOf(ARROWHEAD_TYPES, settings.arrowhead2, current.arrowhead2),
        leaderArrowhead: oneOf(ARROWHEAD_TYPES, settings.leaderArrowhead, current.leaderArrowhead),
        arrowSize: positive(settings.arrowSize, current.arrowSize),
        centerMark: oneOf(CENTER_MARK_TYPES, settings.centerMark, current.centerMark),
        centerMarkSize: positive(settings.centerMarkSize, current.centerMarkSize),

        textHeight: positive(settings.textHeight, current.textHeight),
        textColor: oneOf(COLOR_NAMES, settings.textColor, current.textColor),
        textFill: oneOf(TEXT_FILL_TYPES, settings.textFill, current.textFill),
        textFillColor: oneOf(COLOR_NAMES, settings.textFillColor, current.textFillColor),
        textVertical: oneOf(TEXT_VERTICAL_PLACEMENTS, settings.textVertical, current.textVertical),
        textHorizontal: oneOf(TEXT_HORIZONTAL_PLACEMENTS, settings.textHorizontal, current.textHorizontal),
        textOffset: nonNegative(settings.textOffset, current.textOffset),
        textAlignment: oneOf(TEXT_ALIGNMENTS, settings.textAlignment, current.textAlignment),

        fit: oneOf(FIT_OPTIONS, settings.fit, current.fit),
        overallScale: positive(settings.overallScale, current.overallScale),
        drawDimLineBetweenExtLines: flag(
            settings.drawDimLineBetweenExtLines,
            current.drawDimLineBetweenExtLines,
        ),

        // Not clamped here: precision means a fraction denominator under architectural and
        // fractional units, so a decimal-places range would reject 16. UnitSetup.formatLength
        // validates it against the active unit type instead.
        precision:
            typeof settings.precision === "number" && Number.isFinite(settings.precision)
                ? Math.max(0, Math.round(settings.precision))
                : current.precision,
        // A separator has to be exactly one character or it would be spliced into the
        // number as a substring; anything else falls back rather than corrupting the text.
        decimalSeparator:
            typeof settings.decimalSeparator === "string" && settings.decimalSeparator.length === 1
                ? settings.decimalSeparator
                : current.decimalSeparator,
        roundOff: nonNegative(settings.roundOff, current.roundOff),
        prefix: text(settings.prefix, current.prefix),
        suffix: text(settings.suffix, current.suffix),
        // A zero scale would report every measurement as 0; a negative one would report
        // them all as negative. Both are user error rather than intent.
        measurementScale: positive(settings.measurementScale, current.measurementScale),
        suppressLeadingZeros: flag(settings.suppressLeadingZeros, current.suppressLeadingZeros),
        suppressTrailingZeros: flag(settings.suppressTrailingZeros, current.suppressTrailingZeros),
        angularFormat: oneOf(ANGULAR_FORMATS, settings.angularFormat, current.angularFormat),
        angularPrecision: decimals(settings.angularPrecision, current.angularPrecision),
        angularSuppressLeadingZeros: flag(
            settings.angularSuppressLeadingZeros,
            current.angularSuppressLeadingZeros,
        ),
        angularSuppressTrailingZeros: flag(
            settings.angularSuppressTrailingZeros,
            current.angularSuppressTrailingZeros,
        ),

        alternateEnabled: flag(settings.alternateEnabled, current.alternateEnabled),
        alternateMultiplier: positive(settings.alternateMultiplier, current.alternateMultiplier),
        alternatePrecision: decimals(settings.alternatePrecision, current.alternatePrecision),
        alternateRoundOff: nonNegative(settings.alternateRoundOff, current.alternateRoundOff),
        alternatePrefix: text(settings.alternatePrefix, current.alternatePrefix),
        alternateSuffix: text(settings.alternateSuffix, current.alternateSuffix),
        alternatePlacement: oneOf(
            ALTERNATE_PLACEMENTS,
            settings.alternatePlacement,
            current.alternatePlacement,
        ),
        alternateSuppressLeadingZeros: flag(
            settings.alternateSuppressLeadingZeros,
            current.alternateSuppressLeadingZeros,
        ),
        alternateSuppressTrailingZeros: flag(
            settings.alternateSuppressTrailingZeros,
            current.alternateSuppressTrailingZeros,
        ),

        toleranceMethod: oneOf(TOLERANCE_METHODS, settings.toleranceMethod, current.toleranceMethod),
        tolerancePrecision: decimals(settings.tolerancePrecision, current.tolerancePrecision),
        // Tolerances are signed: DIMTM is conventionally entered as a positive magnitude
        // that is subtracted, but a drawing may legitimately carry two positive limits.
        toleranceUpper: finite(settings.toleranceUpper, current.toleranceUpper),
        toleranceLower: finite(settings.toleranceLower, current.toleranceLower),
        toleranceTextScale: positive(settings.toleranceTextScale, current.toleranceTextScale),
        toleranceAlignment: oneOf(
            TOLERANCE_ALIGNMENTS,
            settings.toleranceAlignment,
            current.toleranceAlignment,
        ),
        toleranceSuppressLeadingZeros: flag(
            settings.toleranceSuppressLeadingZeros,
            current.toleranceSuppressLeadingZeros,
        ),
        toleranceSuppressTrailingZeros: flag(
            settings.toleranceSuppressTrailingZeros,
            current.toleranceSuppressTrailingZeros,
        ),
    };
}
