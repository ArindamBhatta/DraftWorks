import {
    DRAWING_MODE_INFO,
    type DrawingMode,
    type Generator,
    type GeneratorRegistry,
    isTechnicalMode,
    type ParamDef,
} from "@draftworks/generators";
import type { ToolSpec } from "./conversation";
import { FREEFORM_DRAW, FREEFORM_TOOL } from "./freeform";
import { ASK_QUESTIONS, QUESTIONS_TOOL } from "./questions";

/**
 * The tool a model reaches for when the request is not a drawing at all.
 *
 * Without it, forcing a tool call would make a wrong choice the only available answer, so
 * an explicit way to decline is what lets the panel say "I can't draw that" rather than
 * invent something. But it is deliberately narrow, and the narrowness is the point:
 * anything that can be put on a canvas as lines and arcs has `FREEFORM_DRAW`, and every
 * over-refusal this tool has caused - a gym layout, a pile detail, a quick sketch of a
 * person - came from reaching for it when freeform was right there.
 */
export const CANNOT_DRAW = "cannot_draw";

const CANNOT_DRAW_TOOL: ToolSpec = {
    name: CANNOT_DRAW,
    description:
        "Use this only when the request is not a drawing at all, or asks for something that " +
        `cannot be put on a 2D canvas as lines, arcs and text. If it can be drawn - however ` +
        `roughly - call ${FREEFORM_DRAW} instead. Do not guess at a different drawing.`,
    schema: {
        type: "object",
        properties: {
            reason: {
                type: "string",
                description:
                    "One sentence, spoken to the draftsman, on what cannot be drawn. Say what " +
                    "the drawing would need, not what you are.",
            },
        },
        required: ["reason"],
        additionalProperties: false,
    },
};

/**
 * Turns a generator's parameter declarations into a tool schema.
 *
 * Lengths are declared as strings on purpose: only the drawing knows whether "40" means
 * 40 millimetres or 40 feet, so the model passes the draftsman's words through
 * unchanged and the host resolves them against the document's unit settings.
 */
export function toolFromGenerator(generator: Generator<unknown>): ToolSpec {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of generator.params) {
        properties[param.name] = schemaOf(param);
        if (param.required) required.push(param.name);
    }

    const examples = generator.examples.map((e) => `  - "${e}"`).join("\n");
    return {
        name: generator.id,
        description: `${generator.description}\n\nRequests this covers:\n${examples}`,
        schema: { type: "object", properties, required, additionalProperties: false },
    };
}

function schemaOf(param: ParamDef): Record<string, unknown> {
    const description = param.description;
    switch (param.type) {
        case "length":
            return {
                type: "string",
                description: `${description} Pass the draftsman's own words, e.g. "30'", "9000", "3'-6\\"".`,
            };
        case "integer":
            return { type: "integer", description, ...bounds(param) };
        case "number":
            return { type: "number", description, ...bounds(param) };
        case "enum":
            return { type: "string", description, enum: param.values };
        case "boolean":
            return { type: "boolean", description };
    }
}

function bounds(param: ParamDef): { minimum?: number; maximum?: number } {
    return {
        ...(param.min === undefined ? {} : { minimum: param.min }),
        ...(param.max === undefined ? {} : { maximum: param.max }),
    };
}

/**
 * The tools for one mode.
 *
 * The freehand mode is handed neither the generators nor the question tool. Prose alone
 * would not reliably stop a model interviewing someone about the dimensions of a sketch;
 * leaving it no way to ask does.
 */
export function buildTools(registry: GeneratorRegistry, mode: DrawingMode): ToolSpec[] {
    if (!isTechnicalMode(mode)) return [FREEFORM_TOOL, CANNOT_DRAW_TOOL];

    // Order is deliberate: the generators first, so the nearest exact match is the most
    // salient, then the general escape hatches after them.
    return [...registry.byMode(mode).map(toolFromGenerator), QUESTIONS_TOOL, FREEFORM_TOOL, CANNOT_DRAW_TOOL];
}

export function buildSystemPrompt(registry: GeneratorRegistry, mode: DrawingMode): string {
    const info = DRAWING_MODE_INFO[mode];

    // Naming the roles explicitly. Left unsaid, a model handed a catalogue of drawings and
    // a person called "the draftsman" will take the title for itself and answer as one.
    const preamble = [
        "You are the drawing assistant inside a 2D CAD program. The person you are talking to is",
        "the draftsman; you are not one, so never describe yourself as one. You turn their request",
        "into one call to one drawing tool, and whatever you call is drawn on the canvas",
        "immediately.",
        "",
        `The draftsman is working in ${info.title} mode. ${info.brief}`,
        "",
    ];

    const body = info.technical ? technicalBody(registry.byMode(mode)) : freehandBody();
    return [...preamble, ...body].join("\n");
}

function technicalBody(generators: Generator<unknown>[]): string[] {
    const catalogue = generators.length
        ? [
              "The purpose-built drawings in this mode, which draw their own geometry from a few",
              "parameters:",
              ...generators.map((g) => `- ${g.id}: ${g.title}`),
          ]
        : [
              "This mode has no purpose-built drawing yet, so everything in it is geometry you emit",
              `yourself with ${FREEFORM_DRAW}. That is expected - it is not a reason to decline.`,
          ];

    // The steps are numbered around the catalogue rather than through it: telling a model
    // to "call one of the drawings above" when there are none above invites it to decide
    // the mode is empty and decline.
    const steps = [
        "Choosing between the tools, in order:",
        "1. If the request leaves open anything that would change the geometry, call",
        `   ${ASK_QUESTIONS} before drawing anything. This is a drawing someone builds from: one`,
        "   more turn costs less than a wrong assumption drawn to scale.",
        ...(generators.length
            ? [
                  "2. If one of the drawings above covers the request, call it. It produces a better",
                  "   drawing than emitting geometry yourself, so never hand-draw what it can make.",
                  `3. Otherwise call ${FREEFORM_DRAW} and emit the geometry yourself.`,
                  `4. Call ${CANNOT_DRAW} only if the request is not a drawing at all.`,
              ]
            : [
                  `2. Otherwise call ${FREEFORM_DRAW} and emit the geometry yourself.`,
                  `3. Call ${CANNOT_DRAW} only if the request is not a drawing at all.`,
              ]),
    ];

    const lengths = generators.length
        ? [
              '- Pass lengths through as written for the drawings above. "30x40" means width 30,',
              "  depth 40. Do not convert units and do not add units of your own - the drawing",
              `  resolves them. (${FREEFORM_DRAW} is the exception: it is always millimetres.)`,
          ]
        : [`- ${FREEFORM_DRAW} coordinates are always millimetres, whatever units were asked in.`];

    return [
        ...catalogue,
        "",
        ...steps,
        "",
        "Rules:",
        "- Call exactly one tool, every turn.",
        "- Fill in only what the draftsman actually said or clearly implied. Leave anything",
        "  else out; the program has sensible defaults for every optional parameter.",
        ...lengths,
        "- On a follow-up turn, carry over the previous call's values and change only what the",
        "  draftsman asked to change.",
        `- Ask at most once per drawing. After the answers come back, draw - do not call`,
        `  ${ASK_QUESTIONS} again for the same request.`,
    ];
}

function freehandBody(): string[] {
    return [
        "Choosing between the tools:",
        `1. Call ${FREEFORM_DRAW}. Nearly anything asked for here can be built out of lines, arcs`,
        "   and text, and drawing it is what the draftsman wants.",
        `2. Call ${CANNOT_DRAW} only if the request is not a drawing at all.`,
        "",
        "Rules:",
        "- Call exactly one tool, every turn.",
        "- Do not ask what size, what view, or what level of detail. Choose something sensible",
        "  and draw it.",
        "- Nothing here is built from and nothing here is dimensioned, so a recognisable sketch",
        "  is a complete answer. Do not decline because the request is loose, informal, or not a",
        "  technical subject - drawing exactly those is what this mode is for.",
        "- Coordinates are millimetres. Keep the drawing inside roughly 1000 x 1000.",
        "- On a follow-up turn, redraw with only what the draftsman asked to change.",
    ];
}
