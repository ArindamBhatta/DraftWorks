import { Result } from "@chili3d/core";
import type { DrawingMode } from "./modes";
import type { DrawItem, LayerSpec, LengthFormatter } from "./types";

/**
 * One parameter of a generator, described richly enough that the same declaration can
 * drive three consumers: a JSON Schema handed to Claude as a tool, a hand-editable form
 * in the panel, and the coercion that turns typed text into numbers.
 *
 * `description` is prompt text - it is what the model reads to decide what to put here,
 * so write it for a reader who cannot see the code.
 */
export interface ParamDef {
    name: string;
    /**
     * "length" values arrive as strings ("40'", "9000", "3'-6\"") because only the
     * drawing's own unit settings can resolve them; everything else arrives typed.
     */
    type: "length" | "number" | "integer" | "enum" | "boolean";
    description: string;
    required: boolean;
    default?: unknown;
    /** enum only. */
    values?: readonly string[];
    /** length/number/integer only. Lengths are bounded in millimetres. */
    min?: number;
    max?: number;
}

/**
 * Everything a generator needs from the host that is not one of its own parameters.
 *
 * Length text is parsed by the host rather than the generator because only the drawing
 * knows what "40" means - 40 mm in one document and 40 feet in another. Injecting it
 * also keeps generators free of global state and trivially testable.
 */
export interface GeneratorContext {
    /** Formats a millimetre length the way the current drawing would display it. */
    format: LengthFormatter;
    /** Parses length text ("40'", "9000", "3'-6\"") into millimetres. */
    parseLength: (text: string) => number | undefined;
}

/** A generator's refusal, structured so the UI can explain it rather than just fail. */
export interface GeneratorError {
    code: string;
    message: string;
    detail?: Record<string, number | string>;
}

/**
 * A self-describing drawing generator. Registering one is all it takes to teach the AI
 * router about it - the router builds its tool list from `params`, and the renderer
 * builds its layers from `layers`. Neither has generator-specific code.
 */
export interface Generator<P> {
    /** Stable id, also the tool name exposed to the model. */
    id: string;
    title: string;
    /** Which tab this belongs to. The model is only ever offered its own mode's drawings. */
    mode: DrawingMode;
    /** For the model: when should this generator be chosen over the others? */
    description: string;
    /** Example phrasings a draftsman might use, shown in the UI and given to the model. */
    examples: string[];
    params: ParamDef[];
    layers: LayerSpec[];
    /** Turns loosely-typed input (from the model or the form) into a validated spec. */
    coerce(raw: Record<string, unknown>, ctx: GeneratorContext): Result<P, GeneratorError>;
    generate(spec: P, ctx: GeneratorContext): Result<DrawItem[], GeneratorError>;
    /** One line describing what is about to be drawn, for the panel to read back. */
    summarize(spec: P, ctx: GeneratorContext): string;
}

export class GeneratorRegistry {
    readonly #generators = new Map<string, Generator<unknown>>();

    register(generator: Generator<unknown>): this {
        this.#generators.set(generator.id, generator);
        return this;
    }

    get(id: string): Generator<unknown> | undefined {
        return this.#generators.get(id);
    }

    all(): Generator<unknown>[] {
        return [...this.#generators.values()];
    }

    /** The drawings belonging to one tab, in registration order. */
    byMode(mode: DrawingMode): Generator<unknown>[] {
        return this.all().filter((generator) => generator.mode === mode);
    }

    get size(): number {
        return this.#generators.size;
    }
}

/** Builds a `raw` record from a generator's declared defaults. */
export function defaultsOf(generator: Generator<unknown>): Record<string, unknown> {
    const raw: Record<string, unknown> = {};
    for (const param of generator.params) {
        if (param.default !== undefined) raw[param.name] = param.default;
    }
    return raw;
}

export function generatorError<T>(
    code: string,
    message: string,
    detail?: Record<string, number | string>,
): Result<T, GeneratorError> {
    return Result.err({ code, message, detail });
}

/**
 * Turns loosely-typed input - from a Claude tool call or from the panel's own form -
 * into a plain record of validated values, applying declared defaults for anything
 * omitted. Generators call this before casting to their own spec type, so the same
 * validation covers both entry paths.
 */
export function coerceParams(
    params: ParamDef[],
    raw: Record<string, unknown>,
    ctx: GeneratorContext,
): Result<Record<string, unknown>, GeneratorError> {
    const out: Record<string, unknown> = {};

    for (const param of params) {
        const supplied = raw[param.name];
        if (supplied === undefined || supplied === null || supplied === "") {
            if (param.default !== undefined) {
                out[param.name] = param.default;
                continue;
            }
            if (param.required) {
                return generatorError("missingParam", `"${param.name}" is required.`);
            }
            continue;
        }

        const value = coerceOne(param, supplied, ctx);
        if (value === undefined) {
            return generatorError(
                "invalidParam",
                `"${String(supplied)}" is not a valid value for "${param.name}".`,
            );
        }
        if (typeof value === "number") {
            if (param.min !== undefined && value < param.min) {
                return generatorError("invalidParam", `"${param.name}" must be at least ${param.min}.`);
            }
            if (param.max !== undefined && value > param.max) {
                return generatorError("invalidParam", `"${param.name}" must be at most ${param.max}.`);
            }
        }
        out[param.name] = value;
    }

    return Result.ok(out);
}

function coerceOne(param: ParamDef, supplied: unknown, ctx: GeneratorContext): unknown {
    switch (param.type) {
        case "length": {
            if (typeof supplied === "number") return Number.isFinite(supplied) ? supplied : undefined;
            return typeof supplied === "string" ? ctx.parseLength(supplied) : undefined;
        }
        case "number":
        case "integer": {
            const n = typeof supplied === "number" ? supplied : Number(String(supplied).trim());
            if (!Number.isFinite(n)) return undefined;
            return param.type === "integer" ? Math.round(n) : n;
        }
        case "enum": {
            const text = String(supplied).trim().toLowerCase();
            return param.values?.find((v) => v.toLowerCase() === text);
        }
        case "boolean": {
            if (typeof supplied === "boolean") return supplied;
            const text = String(supplied).trim().toLowerCase();
            if (["true", "yes", "1"].includes(text)) return true;
            if (["false", "no", "0"].includes(text)) return false;
            return undefined;
        }
    }
}
