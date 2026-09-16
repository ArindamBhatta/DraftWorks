import { ObjectStorage } from "../objectStorage";

export type UnitType = "architectural" | "engineering" | "decimal" | "fractional" | "scientific";
export type BaseUnit = "mm" | "cm" | "m" | "in" | "ft";

export interface UnitSettings {
    type: UnitType;
    baseUnit: BaseUnit;
    /**
     * Precision means two different things depending on the type, mirroring AutoCAD's
     * single Precision dropdown whose choices change with the selected type:
     * - architectural / fractional: the fraction denominator (1, 2, 4 ... 128)
     * - decimal / engineering / scientific: the number of decimal places (0 ... 8)
     *
     * Because the two scales are incompatible, never carry a precision across a type
     * change without validating it - use `configure()`, which does that for you.
     */
    precision: number;
}

/** Fraction denominators AutoCAD offers for architectural/fractional lengths. */
const FRACTION_DENOMINATORS = [1, 2, 4, 8, 16, 32, 64, 128] as const;
const MAX_DECIMAL_PLACES = 8;

const DEFAULT_PRECISION: Record<UnitType, number> = {
    architectural: 16, // 1/16"
    fractional: 16, // 1/16
    engineering: 4,
    decimal: 4,
    scientific: 4,
};

/**
 * How many inches one drawing unit represents. Architectural and engineering formats
 * are inherently feet/inch based, so they convert through this; decimal, fractional and
 * scientific display the raw drawing units, exactly as AutoCAD does.
 */
const INCHES_PER_UNIT: Record<BaseUnit, number> = {
    mm: 1 / 25.4,
    cm: 1 / 2.54,
    m: 1000 / 25.4,
    in: 1,
    ft: 12,
};

const INCHES_PER_FOOT = 12;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** localStorage key holding the unit settings between sessions. */
const STORAGE_KEY = "unitSetup";

export class UnitSetup {
    private static _currentSettings: UnitSettings = {
        type: "architectural",
        baseUnit: "in",
        precision: 16,
    };

    /**
     * True once settings have been read back from a previous session, so start-up can
     * tell "the user has chosen units before" from "this is a first run" and skip
     * re-asking. AutoCAD does not interrogate a returning user about units either.
     */
    static #restored = false;
    static get isRestored(): boolean {
        return UnitSetup.#restored;
    }

    /**
     * Load the settings saved by the last session. Call once during start-up, before
     * anything formats a length. Safe to call when nothing was ever saved - it leaves
     * the defaults in place and reports false.
     */
    static restore(): boolean {
        const saved = ObjectStorage.default.value<Partial<UnitSettings>>(STORAGE_KEY);
        if (!saved?.type) return false;

        UnitSetup.configure(saved);
        UnitSetup.#restored = true;
        return true;
    }

    static get settings(): UnitSettings {
        return { ...UnitSetup._currentSettings };
    }

    /**
     * Applies a partial settings change. Changing the type without naming a precision
     * re-defaults the precision for that type, because a precision that is meaningful
     * for one type is nonsense for another - carrying architectural's 16 ("1/16 inch")
     * into decimal would otherwise render 16 decimal places.
     */
    static configure(settings: Partial<UnitSettings>): void {
        const current = UnitSetup._currentSettings;
        const type = settings.type ?? current.type;
        UnitSetup._currentSettings = {
            type,
            baseUnit: settings.baseUnit ?? current.baseUnit,
            precision: UnitSetup.resolvePrecision(type, settings.precision, current.precision),
        };
        // Written through on every change rather than saved by the dialog, so any caller
        // that configures units gets persistence without having to remember to ask.
        ObjectStorage.default.setValue(STORAGE_KEY, UnitSetup._currentSettings);
    }

    /**
     * How many millimetres one drawing unit measures.
     *
     * Only the base unit decides this; the format is how a length is *written*, not how
     * big it is. Plotting is what needs it: a sheet is in millimetres and a drawing is
     * not, so a plot scale of 1:100 cannot be worked out without knowing which is which.
     */
    static millimetresPerUnit(settings: Partial<UnitSettings> = {}): number {
        const baseUnit = settings.baseUnit ?? UnitSetup._currentSettings.baseUnit;
        return INCHES_PER_UNIT[baseUnit] * 25.4;
    }

    /** True when the type's precision is a fraction denominator rather than decimal places. */
    static usesFractionalPrecision(type: UnitType): boolean {
        return type === "architectural" || type === "fractional";
    }

    static defaultPrecision(type: UnitType): number {
        return DEFAULT_PRECISION[type];
    }

    /** The precision values selectable for a type, for populating a Precision dropdown. */
    static precisionOptions(type: UnitType): number[] {
        if (UnitSetup.usesFractionalPrecision(type)) return [...FRACTION_DENOMINATORS];
        return Array.from({ length: MAX_DECIMAL_PLACES + 1 }, (_, i) => i);
    }

    /** AutoCAD-style label for a precision option, e.g. `0'-0 1/16"`, `0 1/16`, `0.0000`. */
    static precisionLabel(type: UnitType, precision: number): string {
        if (UnitSetup.usesFractionalPrecision(type)) {
            const fraction = precision === 1 ? "0" : `0 1/${precision}`;
            return type === "architectural" ? `0'-${fraction}"` : fraction;
        }
        return precision === 0 ? "0" : `0.${"0".repeat(precision)}`;
    }

    static isPrecisionValid(type: UnitType, precision: number): boolean {
        if (UnitSetup.usesFractionalPrecision(type)) {
            return (FRACTION_DENOMINATORS as readonly number[]).includes(precision);
        }
        return Number.isInteger(precision) && precision >= 0 && precision <= MAX_DECIMAL_PLACES;
    }

    private static clampPrecision(type: UnitType, precision: number): number {
        if (UnitSetup.isPrecisionValid(type, precision)) return precision;
        if (UnitSetup.usesFractionalPrecision(type) || !Number.isFinite(precision)) {
            return DEFAULT_PRECISION[type];
        }
        return Math.min(MAX_DECIMAL_PLACES, Math.max(0, Math.round(precision)));
    }

    private static resolvePrecision(type: UnitType, explicit: number | undefined, ambient: number): number {
        if (explicit !== undefined) return UnitSetup.clampPrecision(type, explicit);
        return UnitSetup.isPrecisionValid(type, ambient) ? ambient : DEFAULT_PRECISION[type];
    }

    /**
     * Formats a drawing-unit length into its AutoCAD string representation.
     */
    static formatLength(value: number, settings: Partial<UnitSettings> = {}): string {
        const current = UnitSetup._currentSettings;
        const type = settings.type ?? current.type;
        const baseUnit = settings.baseUnit ?? current.baseUnit;
        const precision = UnitSetup.resolvePrecision(type, settings.precision, current.precision);

        const sign = value < 0 ? "-" : "";
        const magnitude = Math.abs(value);
        const inches = magnitude * INCHES_PER_UNIT[baseUnit];

        switch (type) {
            case "architectural":
                return sign + UnitSetup.formatArchitectural(inches, precision);
            case "engineering":
                return sign + UnitSetup.formatEngineering(inches, precision);
            case "fractional":
                return sign + UnitSetup.formatFractional(magnitude, precision);
            case "scientific":
                return sign + UnitSetup.formatScientific(magnitude, precision);
            default:
                return sign + magnitude.toFixed(precision);
        }
    }

    /**
     * Parses an AutoCAD length input (`5'-8 1/2"`, `11'2"`, `5.7083'`, `5 3/4`,
     * `1745.50`, `1.7455E+03`) into drawing units, or `undefined` when the text is not
     * a length at all. Prefer this over `parseLength` so bad input can be reported
     * instead of silently becoming a number.
     */
    static tryParseLength(input: string, settings: Partial<UnitSettings> = {}): number | undefined {
        if (typeof input !== "string") return undefined;
        const baseUnit = settings.baseUnit ?? UnitSetup._currentSettings.baseUnit;

        let text = input.trim();
        if (!text) return undefined;

        let sign = 1;
        if (text.startsWith("-")) {
            sign = -1;
            text = text.slice(1).trim();
        } else if (text.startsWith("+")) {
            text = text.slice(1).trim();
        }
        if (!text) return undefined;

        // Feet-and-inches: 5', 11'2", 5'-8 1/2", 5'8.5"
        const feetMatch = /^(\d+(?:\.\d+)?)'\s*-?\s*(.*)$/.exec(text);
        if (feetMatch) {
            const rest = feetMatch[2].replace(/"$/, "").trim();
            const inches = rest === "" ? 0 : UnitSetup.parseInchPart(rest);
            if (inches === undefined) return undefined;
            const totalInches = Number.parseFloat(feetMatch[1]) * INCHES_PER_FOOT + inches;
            return (sign * totalInches) / INCHES_PER_UNIT[baseUnit];
        }

        // Inches-only with an explicit mark: 8", 8 1/2"
        if (text.endsWith('"')) {
            const inches = UnitSetup.parseInchPart(text.slice(0, -1).trim());
            if (inches === undefined) return undefined;
            return (sign * inches) / INCHES_PER_UNIT[baseUnit];
        }

        // Unmarked input is already in drawing units: 1745.50, 5 3/4, 1.7455E+03
        const value = UnitSetup.parseInchPart(text);
        return value === undefined ? undefined : sign * value;
    }

    static isValidLength(input: string): boolean {
        return UnitSetup.tryParseLength(input) !== undefined;
    }

    /**
     * Back-compatible parser that yields 0 for unparseable input. New callers should use
     * `tryParseLength`/`isValidLength` so invalid text can be surfaced to the user.
     */
    static parseLength(input: string): number {
        return UnitSetup.tryParseLength(input) ?? 0;
    }

    /** Parses `8`, `8.5`, `1/2`, `8 1/2` or `1.7455E+03`; rejects anything else. */
    private static parseInchPart(text: string): number | undefined {
        const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(text);
        if (mixed) {
            const denominator = Number.parseInt(mixed[3], 10);
            if (denominator === 0) return undefined;
            return Number.parseInt(mixed[1], 10) + Number.parseInt(mixed[2], 10) / denominator;
        }

        const fraction = /^(\d+)\/(\d+)$/.exec(text);
        if (fraction) {
            const denominator = Number.parseInt(fraction[2], 10);
            if (denominator === 0) return undefined;
            return Number.parseInt(fraction[1], 10) / denominator;
        }

        if (/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) {
            return Number.parseFloat(text);
        }

        return undefined;
    }

    private static formatArchitectural(totalInches: number, denominator: number): string {
        // Round once, at fraction granularity, so a value that rounds up to a whole inch
        // (or a whole foot) carries instead of being dropped - 11.99" is 1'-0", not 0'-11".
        const ticks = Math.round(totalInches * denominator);
        const ticksPerFoot = INCHES_PER_FOOT * denominator;
        const feet = Math.floor(ticks / ticksPerFoot);
        const remainder = ticks % ticksPerFoot;
        const inches = Math.floor(remainder / denominator);
        const fraction = UnitSetup.fractionString(remainder % denominator, denominator);

        return fraction ? `${feet}'-${inches} ${fraction}"` : `${feet}'-${inches}"`;
    }

    private static formatEngineering(totalInches: number, decimals: number): string {
        return `${(totalInches / INCHES_PER_FOOT).toFixed(decimals)}'`;
    }

    private static formatFractional(value: number, denominator: number): string {
        const ticks = Math.round(value * denominator);
        const whole = Math.floor(ticks / denominator);
        const fraction = UnitSetup.fractionString(ticks % denominator, denominator);

        if (!fraction) return `${whole}`;
        return whole === 0 ? fraction : `${whole} ${fraction}`;
    }

    /** AutoCAD renders exponents uppercase and zero-padded to two digits: `1.7455E+03`. */
    private static formatScientific(value: number, decimals: number): string {
        return value.toExponential(decimals).replace(/e([+-])(\d+)$/, (_match, exponentSign, digits) => {
            return `E${exponentSign}${digits.padStart(2, "0")}`;
        });
    }

    private static fractionString(numerator: number, denominator: number): string {
        if (numerator === 0) return "";
        const divisor = gcd(numerator, denominator);
        return `${numerator / divisor}/${denominator / divisor}`;
    }
}
