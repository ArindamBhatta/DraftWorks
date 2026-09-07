import type { IDocument } from "../document";
import type { I18nKeys } from "../i18n";
import type { Plane, XYZ } from "../math";
import type { VisualNode } from "../model";
import type { IShapeFilter } from "../selectionFilter";
import type { ShapeMeshData } from "../shape";
import type { IView, VisualShapeData } from "../visual";

/**
 * One bracketed alternative offered at a prompt - AutoCAD's
 * `Specify center point for circle or [3P/2P/Ttr]:`.
 *
 * The same option is reachable several ways on purpose, because the two kinds of
 * user need opposite things. `key` is what a fast user types at the prompt (matched
 * case-insensitively, so `3p` and `3P` both work) - recall, no mouse, no looking
 * away from the drawing. The status bar renders that same key as a clickable link
 * inside the bracket list, with `display` as its tooltip - so a beginner who has
 * never heard of `3P` can still get there, and is shown the keystroke that would
 * have done it while doing so.
 *
 * Whichever way it is chosen, `onSelect` is the one thing that runs, and it edits
 * the command's own observable property. Every surface reads back from that
 * property, so none of them can disagree about what the command is doing.
 */
export interface StepOption {
    /** What the user types to choose this, e.g. "3P". Matched case-insensitively. */
    key: string;
    /** Human label for the option - what the key actually means, used as its tooltip. */
    display: I18nKeys;
    onSelect: () => void;
}

/**
 * The options a prompt offers, either fixed or re-derived on demand.
 *
 * A provider is what makes the two surfaces one pipeline rather than two copies. The
 * options a prompt shows can depend on command state the user may change from
 * somewhere else entirely - Circle's `[Diameter]` becomes `[Radius]` the moment
 * `sizeMode` flips, whether that came from typing `D` at the prompt or from the
 * ribbon's property panel. A snapshot taken when the step started would go stale;
 * a provider is re-asked every time the prompt is refreshed.
 */
export type StepOptions = StepOption[] | (() => StepOption[]);

export function resolveStepOptions(options: StepOptions | undefined): StepOption[] {
    if (options === undefined) return [];
    return typeof options === "function" ? options() : options;
}

/**
 * Whether a prompt offers anything at all.
 *
 * Always ask through this rather than testing `options.length` directly: a provider
 * is a function, and a function's `.length` is its declared parameter count - zero
 * for every provider written so far. TypeScript accepts that reading happily, so
 * the mistake is silent, and it silently disables typing every letter-keyed option
 * (`D`, `R`, `C`) while leaving the digit-keyed ones (`3P`, `2P`) working, because
 * digits open the typing box on their own.
 */
export function hasStepOptions(options: StepOptions | undefined): boolean {
    return resolveStepOptions(options).length > 0;
}

/**
 * The option a typed string chooses, if any - `3p`, `3P` and ` 3P ` all pick `3P`,
 * the way AutoCAD accepts an option however you capitalise it. An empty line never
 * matches: at a prompt that offers options, bare Enter still means "no answer",
 * not "the first option".
 */
export function matchStepOption(options: StepOptions | undefined, text: string): StepOption | undefined {
    const typed = text.trim().toLowerCase();
    if (typed === "") return undefined;
    return resolveStepOptions(options).find((option) => option.key.toLowerCase() === typed);
}

export interface SnapData {
    preview?: (point: XYZ | undefined) => ShapeMeshData[];
    prompt?: (point: SnapResult) => string;
    filter?: IShapeFilter;
    validator?: (point: XYZ) => boolean;
    featurePoints?: {
        point: XYZ;
        prompt: string;
        when?: () => boolean;
    }[];
    /** Alternatives offered at this prompt - typed by key, or clicked in the status bar. */
    options?: StepOptions;
    /**
     * What bare Enter means here - AutoCAD's `<...>` default, as in MOVE's "Specify
     * second point or <use first point as displacement>". Return the point to finish
     * the pick with; return undefined to leave Enter its usual meaning of backing out
     * of the prompt, which is what every prompt without a default still does.
     *
     * The returned point is committed as picked, so it skips snapping and validation
     * for the same reason typed coordinates do: it was not aimed at, it was named.
     */
    onEnter?: () => XYZ | undefined;
    beforeExecute?: () => void;
    afterExecute?: () => void;
    onKeyDown?: (key: KeyboardEvent, update: () => void) => void;
}

export type SnapType =
    | "node"
    | "shape"
    | "vertex"
    | "center"
    | "end"
    | "perpendicular"
    | "intersection"
    | "tangent"
    | "nearCurve"
    | "trace"
    | "traceIntersect"
    | "onSurface"
    | "middle"
    | "axis"
    | "feature"
    | "input"
    | "angle";

export interface SnapResult {
    view: IView;
    type: SnapType;
    point?: XYZ;
    info?: string;
    distance?: number;
    refPoint?: XYZ;
    shapes: VisualShapeData[];
    nodes?: VisualNode[];
    plane?: Plane;
}

export interface MouseAndDetected {
    view: IView;
    mx: number;
    my: number;
    shapes: VisualShapeData[];
}

export interface ISnap {
    snap(data: MouseAndDetected): SnapResult | undefined;
    readonly handleSnaped?: (document: IDocument, snaped?: SnapResult) => void;
    removeDynamicObject(): void;
    clear(): void;
}
