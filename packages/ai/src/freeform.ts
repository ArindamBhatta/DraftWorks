import { LAYER_COLOR_BY_THEME, Result } from "@draftworks/core";
import type { DrawItem, LayerSpec, Vec2 } from "@draftworks/generators";
import type { ToolSpec } from "./conversation";

/**
 * The tool that lets the model draw something no generator covers.
 *
 * This is the one place the app's original rule - "no model produces geometry" - is
 * deliberately relaxed, and the trade is explicit: a generator guarantees a correct
 * drawing from a handful of numbers, while this guarantees only that whatever comes back
 * is *well-formed* geometry. Everything downstream is unchanged, because the output is
 * the same DrawItem list a generator emits, so the preview, the layer handling, the
 * undo step and the DXF export all work without knowing which path produced it.
 *
 * The draftsman is the check that a generator's parameter validation would have been:
 * the preview renders before anything reaches the document.
 */
export const FREEFORM_DRAW = "freeform_draw";

/** What a model may name a colour, beyond an explicit hex value. */
const THEME_COLOR = "theme";

const POINT = {
    type: "object",
    properties: {
        x: { type: "number", description: "Millimetres right of the origin." },
        y: { type: "number", description: "Millimetres up from the origin." },
    },
    required: ["x", "y"],
    additionalProperties: false,
} as const;

export const DRAW_KINDS = ["line", "arc", "circle", "ellipse", "polyline", "text"] as const;

/**
 * One flat schema for every primitive, rather than a `oneOf` per kind.
 *
 * A discriminated union is the honest shape, but the two providers disagree on how much
 * of JSON Schema's combinator vocabulary they accept, and a schema that one silently
 * degrades is worse than a loose one both take literally. So the fields are all optional
 * here and `parseFreeform` enforces what each kind actually requires - which it would
 * have to do anyway, since a schema cannot express "at least two points".
 */
const ITEM = {
    type: "object",
    properties: {
        kind: { type: "string", enum: [...DRAW_KINDS], description: "Which primitive to draw." },
        layer: { type: "string", description: "The tag of one of the layers declared above." },
        a: { ...POINT, description: "line: start point." },
        b: { ...POINT, description: "line: end point." },
        center: { ...POINT, description: "arc, circle, ellipse: centre point." },
        start: { ...POINT, description: "arc: the point the sweep starts from." },
        sweepDeg: {
            type: "number",
            description: "arc: degrees swept from `start` about `center`. Positive is counter-clockwise.",
            minimum: -360,
            maximum: 360,
        },
        radiusMm: { type: "number", description: "circle: radius in millimetres.", exclusiveMinimum: 0 },
        radiusXMm: {
            type: "number",
            description: "ellipse: radius along its own X axis.",
            exclusiveMinimum: 0,
        },
        radiusYMm: {
            type: "number",
            description: "ellipse: radius along its own Y axis.",
            exclusiveMinimum: 0,
        },
        points: {
            type: "array",
            items: POINT,
            description: "polyline: two or more points in order. Do not repeat the first point to close.",
            minItems: 2,
        },
        closed: { type: "boolean", description: "polyline: join the last point back to the first." },
        at: { ...POINT, description: "text: left end of the text baseline." },
        text: { type: "string", description: "text: the characters to draw." },
        heightMm: { type: "number", description: "text: cap height in millimetres.", exclusiveMinimum: 0 },
        rotationDeg: { type: "number", description: "text, ellipse: rotation in degrees. Defaults to 0." },
    },
    required: ["kind", "layer"],
    additionalProperties: false,
} as const;

export const FREEFORM_TOOL: ToolSpec = {
    name: FREEFORM_DRAW,
    description: [
        "Draw something by emitting its geometry directly, for requests no other tool covers.",
        "",
        "Use this for drawings that are built out of lines and curves: elevations, sections,",
        "details, brackets, trusses, stairs, furniture, schematics, logos, diagrams. Prefer a",
        "dedicated tool whenever one fits - it produces a better drawing than you can.",
        "",
        "Work in millimetres at real-world size, with Y pointing up. Build the drawing around",
        "the origin. Draw a clean, orthographic, single-view line drawing - this is CAD, not a",
        "sketch: prefer straight runs, right angles and shared endpoints, and put construction",
        "or annotation on their own layers so the draftsman can turn them off.",
        "",
        // The schema cannot say this - the fields are all optional there, because a
        // discriminated union is what one provider or the other quietly mangles. So the
        // requirement per kind is stated here instead, where both read it as prose.
        "Every item needs `kind` and `layer`, plus the fields that its kind uses. An item",
        "missing any of them refuses the whole drawing, so check each one before sending:",
        "  line: `a`, `b`",
        "  arc: `center`, `start`, non-zero `sweepDeg`",
        "  circle: `center`, positive `radiusMm`",
        "  ellipse: `center`, positive `radiusXMm`, positive `radiusYMm`",
        "  polyline: `points`, two or more",
        "  text: `at`, `text`, positive `heightMm`",
    ].join("\n"),
    schema: {
        type: "object",
        properties: {
            title: {
                type: "string",
                description: "A short name for the drawing, used as the folder name and the undo label.",
            },
            layers: {
                type: "array",
                minItems: 1,
                description:
                    "The layers this drawing needs. Name them the way a drafting office would - " +
                    "OUTLINE, DETAIL, HIDDEN, DIM, TEXT - and put every item on one of them.",
                items: {
                    type: "object",
                    properties: {
                        tag: { type: "string", description: "Short key the items refer to, e.g. OUTLINE." },
                        name: { type: "string", description: "Layer name as it appears to the draftsman." },
                        color: {
                            type: "string",
                            description: `Hex "RRGGBB", or "${THEME_COLOR}" to follow the drawing's light/dark default.`,
                        },
                    },
                    required: ["tag", "name", "color"],
                    additionalProperties: false,
                },
            },
            items: { type: "array", minItems: 1, items: ITEM, description: "The geometry, in draw order." },
        },
        required: ["title", "layers", "items"],
        additionalProperties: false,
    },
};

export interface FreeformDrawing {
    title: string;
    layers: LayerSpec[];
    items: DrawItem[];
}

/**
 * Turns the model's tool arguments into geometry, or says why it cannot.
 *
 * Strict on purpose. A half-valid drawing - three walls of four, a circle with no radius -
 * looks like a bug in the app rather than a bad turn from the model, so a malformed item
 * fails the whole call and the message names the item by index. The panel shows that
 * message and the draftsman can simply ask again.
 */
export function parseFreeform(input: Record<string, unknown>): Result<FreeformDrawing, string> {
    const title = str(input["title"]) ?? "Drawing";

    const rawLayers = input["layers"];
    if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
        return Result.err("The drawing came back with no layers.");
    }
    const layers: LayerSpec[] = [];
    for (const raw of rawLayers) {
        const layer = raw as Record<string, unknown>;
        const tag = str(layer["tag"]);
        if (!tag) return Result.err("A layer came back without a tag.");
        layers.push({ tag, name: str(layer["name"]) ?? tag, color: parseColor(str(layer["color"])) });
    }
    const tags = new Set(layers.map((layer) => layer.tag));

    const rawItems = input["items"];
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return Result.err("The drawing came back empty.");
    }

    const items: DrawItem[] = [];
    for (let i = 0; i < rawItems.length; i++) {
        const parsed = parseItem(rawItems[i] as Record<string, unknown>, tags);
        if (!parsed.isOk) return Result.err(`Item ${i + 1}: ${parsed.error}`);
        items.push(parsed.value);
    }

    return Result.ok({ title, layers, items });
}

function parseItem(raw: Record<string, unknown>, tags: Set<string>): Result<DrawItem, string> {
    const layer = str(raw["layer"]);
    if (!layer) return Result.err("no layer.");
    // Falling back rather than failing: which layer a line sits on is a presentation
    // detail, and losing the whole drawing over one stray tag would be a poor trade.
    const onLayer = tags.has(layer) ? layer : [...tags][0];
    const rotationDeg = num(raw["rotationDeg"]) ?? 0;

    switch (raw["kind"]) {
        case "line": {
            const a = point(raw["a"]);
            const b = point(raw["b"]);
            if (!a || !b) return Result.err("a line needs both `a` and `b`.");
            return Result.ok({ kind: "line", layer: onLayer, a, b });
        }
        case "arc": {
            const center = point(raw["center"]);
            const start = point(raw["start"]);
            const sweepDeg = num(raw["sweepDeg"]);
            if (!center || !start) return Result.err("an arc needs `center` and `start`.");
            if (!sweepDeg) return Result.err("an arc needs a non-zero `sweepDeg`.");
            return Result.ok({ kind: "arc", layer: onLayer, center, start, sweepDeg });
        }
        case "circle": {
            const center = point(raw["center"]);
            const radiusMm = num(raw["radiusMm"]);
            if (!center || !radiusMm || radiusMm <= 0) {
                return Result.err("a circle needs `center` and a positive `radiusMm`.");
            }
            return Result.ok({ kind: "circle", layer: onLayer, center, radiusMm });
        }
        case "ellipse": {
            const center = point(raw["center"]);
            const radiusXMm = num(raw["radiusXMm"]);
            const radiusYMm = num(raw["radiusYMm"]);
            if (!center || !radiusXMm || !radiusYMm || radiusXMm <= 0 || radiusYMm <= 0) {
                return Result.err("an ellipse needs `center` and positive `radiusXMm` and `radiusYMm`.");
            }
            return Result.ok({ kind: "ellipse", layer: onLayer, center, radiusXMm, radiusYMm, rotationDeg });
        }
        case "polyline": {
            const raws = raw["points"];
            if (!Array.isArray(raws)) return Result.err("a polyline needs `points`.");
            const points = raws.map(point).filter((p): p is Vec2 => p !== undefined);
            if (points.length < 2) return Result.err("a polyline needs at least two valid points.");
            return Result.ok({ kind: "polyline", layer: onLayer, points, closed: raw["closed"] === true });
        }
        case "text": {
            const at = point(raw["at"]);
            const text = str(raw["text"]);
            const heightMm = num(raw["heightMm"]);
            if (!at || !text) return Result.err("text needs `at` and `text`.");
            if (!heightMm || heightMm <= 0) return Result.err("text needs a positive `heightMm`.");
            return Result.ok({ kind: "text", layer: onLayer, at, text, heightMm, rotationDeg });
        }
        default:
            return Result.err(`unknown kind "${String(raw["kind"])}".`);
    }
}

/** Accepts "RRGGBB", "#RRGGBB" or "theme"; anything else follows the theme. */
function parseColor(value: string | undefined): number {
    if (!value || value.toLowerCase() === THEME_COLOR) return LAYER_COLOR_BY_THEME;
    const hex = Number.parseInt(value.replace(/^#/, ""), 16);
    return Number.isFinite(hex) && hex >= 0 && hex <= 0xffffff ? hex : LAYER_COLOR_BY_THEME;
}

function point(value: unknown): Vec2 | undefined {
    if (!value || typeof value !== "object") return undefined;
    const x = num((value as Record<string, unknown>)["x"]);
    const y = num((value as Record<string, unknown>)["y"]);
    return x === undefined || y === undefined ? undefined : { x, y };
}

function num(value: unknown): number | undefined {
    // Models occasionally quote a number; taking the string spares a whole failed turn.
    const n = typeof value === "string" ? Number(value) : value;
    return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function str(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
