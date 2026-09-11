/**
 * Turns a measured quantity into the label a dimension carries - everything the Primary
 * Units, Alternate Units and Tolerances tabs of DIMSTYLE control.
 *
 * Kept apart from `dimensionGeometry` because none of it is geometry: the same three tabs
 * decide what a measurement *reads* as without moving a single line, and the rules are
 * fiddly enough (rounding before formatting, zero suppression after it, a decimal
 * separator applied after that, alternate units that may sit inline or on their own line)
 * to be worth testing on their own.
 *
 * The result is a small structure rather than one string because the two renderers draw
 * the parts differently - a stacked tolerance is two half-height lines beside the
 * measurement in the viewport and two `<tspan>`s in the setup dialog's preview - and both
 * need to know which part is which. `flattenDimensionLabel` collapses it for callers that
 * genuinely want plain text, such as the DXF exporter.
 */

import type { AngularFormat, DimensionSettings, ToleranceAlignment, ToleranceMethod } from "./dimensionStyle";
import { UnitSetup } from "./unitSetup";

export interface DimensionLabel {
    /**
     * The measurement line: prefix, the formatted value, suffix, and the alternate
     * measurement when it is placed inline. Empty only under the `limits` tolerance
     * method, which replaces the measurement with the two limits themselves.
     */
    text: string;
    /** The alternate measurement when Alternate Units places it below the primary. */
    secondary?: string;
    /**
     * Upper and lower tolerance, drawn stacked beside the measurement at
     * `toleranceTextScale`. Under `symmetrical` only `upper` is set, as a single `±` line.
     */
    tolerance?: { upper: string; lower?: string };
    /** Which tolerance line sits on the measurement's baseline (DIMTOLJ). */
    toleranceAlignment: ToleranceAlignment;
    /** Height of the tolerance text relative to the measurement's (DIMTFAC). */
    toleranceScale: number;
    /** `basic`: draw a rectangle round the whole label. */
    boxed: boolean;
}

/** What is being measured - angles format by their own rules, lengths by the unit type. */
export type MeasurementKind = "length" | "angle";

const GRADIANS_PER_DEGREE = 10 / 9;
const DEGREES_PER_RADIAN = 180 / Math.PI;

/** Rounds to an arbitrary increment, the way DIMRND does. `0` means "do not round". */
function roundTo(value: number, increment: number): number {
    if (!(increment > 0)) return value;
    return Math.round(value / increment) * increment;
}

/**
 * DIMZIN and friends, applied to an already-formatted number.
 *
 * Trailing runs before leading so that `0.500` reaches `.5` rather than stalling at `.500`,
 * and a string with no decimal point is left alone by both - `128` has no trailing zeros
 * to suppress, only significant digits.
 */
function suppressZeros(formatted: string, leading: boolean, trailing: boolean): string {
    let result = formatted;

    if (trailing && result.includes(".")) {
        result = result.replace(/\.?0+$/, "");
        if (result === "" || result === "-") result += "0";
    }

    if (leading) {
        // Architectural and engineering strings carry a feet part, where "leading zero"
        // means the 0 feet rather than the 0 units - `0'-6"` reads as `6"`.
        result = result.replace(/^(-?)0'-/, "$1");
        result = result.replace(/^(-?)0\./, "$1.");
    }

    return result;
}

/** DIMDSEP. Applied last, so the zero-suppression rules above can assume a `.`. */
const applySeparator = (formatted: string, separator: string): string =>
    separator === "." ? formatted : formatted.split(".").join(separator);

/**
 * A length in the drawing's own unit format, at `precision`, with the style's rounding,
 * measurement scale and zero suppression applied. This is the primary-units pipeline;
 * alternate units take the simpler decimal path in `formatAlternate`.
 */
function formatPrimaryLength(value: number, settings: DimensionSettings): string {
    const scaled = roundTo(value * settings.measurementScale, settings.roundOff);
    const formatted = UnitSetup.formatLength(scaled, { precision: settings.precision });
    return applySeparator(
        suppressZeros(formatted, settings.suppressLeadingZeros, settings.suppressTrailingZeros),
        settings.decimalSeparator,
    );
}

/** DIMAUNIT. Degrees in, whichever unit the style asks for out. */
function formatAngle(degrees: number, settings: DimensionSettings): string {
    const format: AngularFormat = settings.angularFormat;
    const places = settings.angularPrecision;
    const finish = (formatted: string) =>
        applySeparator(
            suppressZeros(
                formatted,
                settings.angularSuppressLeadingZeros,
                settings.angularSuppressTrailingZeros,
            ),
            settings.decimalSeparator,
        );

    switch (format) {
        case "degreesMinutesSeconds": {
            // Carry upward before rendering: 59.999 minutes rounded at the seconds place
            // is 60, which has to become the next minute rather than print as `59'60"`.
            const sign = degrees < 0 ? "-" : "";
            let total = Math.abs(degrees);
            let d = Math.floor(total);
            total = (total - d) * 60;
            let m = Math.floor(total);
            let s = Number(((total - m) * 60).toFixed(Math.max(0, places)));
            if (s >= 60) {
                s -= 60;
                m += 1;
            }
            if (m >= 60) {
                m -= 60;
                d += 1;
            }
            const seconds = finish(s.toFixed(Math.max(0, places)));
            return `${sign}${d}°${String(m).padStart(2, "0")}'${seconds}"`;
        }
        case "gradians":
            return `${finish((degrees * GRADIANS_PER_DEGREE).toFixed(places))}g`;
        case "radians":
            return `${finish((degrees / DEGREES_PER_RADIAN).toFixed(places))}r`;
        default:
            return `${finish(degrees.toFixed(places))}°`;
    }
}

/** DIMALTF/DIMALTRND/DIMALTD/DIMALTZ, wrapped in the brackets AutoCAD writes them in. */
function formatAlternate(value: number, settings: DimensionSettings): string {
    const converted = roundTo(
        value * settings.measurementScale * settings.alternateMultiplier,
        settings.alternateRoundOff,
    );
    const formatted = applySeparator(
        suppressZeros(
            converted.toFixed(settings.alternatePrecision),
            settings.alternateSuppressLeadingZeros,
            settings.alternateSuppressTrailingZeros,
        ),
        settings.decimalSeparator,
    );
    return `[${settings.alternatePrefix}${formatted}${settings.alternateSuffix}]`;
}

/** A tolerance magnitude, at DIMTDEC and under DIMTZIN. */
function formatToleranceValue(value: number, settings: DimensionSettings): string {
    return applySeparator(
        suppressZeros(
            value.toFixed(settings.tolerancePrecision),
            settings.toleranceSuppressLeadingZeros,
            settings.toleranceSuppressTrailingZeros,
        ),
        settings.decimalSeparator,
    );
}

/**
 * The `limits` method draws the two extreme sizes instead of a nominal one, so it needs
 * the measured value; every other method only needs the tolerances themselves.
 */
function buildTolerance(
    method: ToleranceMethod,
    value: number,
    settings: DimensionSettings,
): DimensionLabel["tolerance"] {
    const upper = settings.toleranceUpper;
    const lower = settings.toleranceLower;

    switch (method) {
        case "symmetrical":
            // A symmetrical tolerance of zero is no tolerance at all, and `±0` on every
            // dimension is noise rather than information.
            return upper === 0 ? undefined : { upper: `±${formatToleranceValue(Math.abs(upper), settings)}` };
        case "deviation": {
            if (upper === 0 && lower === 0) return undefined;
            const sign = (n: number) => (n < 0 ? "-" : "+");
            return {
                upper: `${sign(upper)}${formatToleranceValue(Math.abs(upper), settings)}`,
                // DIMTM is entered as the magnitude to subtract, so a positive entry
                // renders as a minus - the convention every AutoCAD drawing uses.
                lower: `${lower === 0 ? "-" : sign(-lower)}${formatToleranceValue(Math.abs(lower), settings)}`,
            };
        }
        case "limits":
            return {
                upper: formatPrimaryLength(value + upper, settings),
                lower: formatPrimaryLength(value - lower, settings),
            };
        default:
            return undefined;
    }
}

/**
 * Builds the label for one measurement.
 *
 * `value` is the raw measured quantity in drawing units - degrees for an angle - before
 * DIMLFAC and DIMRND, both of which are applied here. `prefix` carries the marker a
 * dimension type puts in front of its own measurement (`R`, `⌀`); the style's own DIMPOST
 * prefix goes outside it, so an architectural suffix style reads `R25.00 mm` rather than
 * splitting the radius marker off from its number.
 */
export function formatDimensionLabel(
    value: number,
    settings: DimensionSettings,
    kind: MeasurementKind = "length",
    typePrefix = "",
): DimensionLabel {
    const method = settings.toleranceMethod;

    // Angles have no alternate units and no limits in AutoCAD either - both are defined
    // in terms of linear conversion factors that mean nothing for degrees.
    const isAngle = kind === "angle";
    const measurement = isAngle ? formatAngle(value, settings) : formatPrimaryLength(value, settings);

    const tolerance = isAngle ? undefined : buildTolerance(method, value, settings);
    const usesLimits = method === "limits" && tolerance !== undefined;

    const alternate = settings.alternateEnabled && !isAngle ? formatAlternate(value, settings) : undefined;
    const inlineAlternate = alternate !== undefined && settings.alternatePlacement === "after";

    // Under `limits` the two limit values *are* the measurement, so the measurement line
    // holds only the affixes - and with none set it is empty, which the renderers treat
    // as "draw the stacked pair alone".
    const body = usesLimits ? "" : `${typePrefix}${measurement}`;
    const text = [settings.prefix, body, settings.suffix, inlineAlternate ? ` ${alternate}` : ""].join("");

    return {
        text,
        secondary: alternate !== undefined && !inlineAlternate ? alternate : undefined,
        tolerance,
        toleranceAlignment: settings.toleranceAlignment,
        toleranceScale: settings.toleranceTextScale,
        boxed: method === "basic",
    };
}

/**
 * The label as one plain string, tolerance and alternate units included - for the DXF
 * exporter and anywhere else that has nowhere to put a stacked fraction. Lines are
 * separated by `\n`, matching what a DXF MTEXT would carry.
 */
export function flattenDimensionLabel(label: DimensionLabel): string {
    const { upper, lower } = label.tolerance ?? {};
    const inline = upper === undefined ? "" : lower === undefined ? ` ${upper}` : ` ${upper}/${lower}`;
    const first = `${label.text}${inline}`.trim();
    return label.secondary ? `${first}\n${label.secondary}` : first;
}
