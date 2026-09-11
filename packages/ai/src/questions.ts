import { Result } from "@chili3d/core";
import type { ToolSpec } from "./conversation";

/**
 * The tool the model reaches for instead of drawing, when the request does not yet
 * determine a drawing.
 *
 * A request like "draw a staircase" has a dozen good answers and one of them is on the
 * canvas a second later, which is the wrong moment to discover the scale was wrong. The
 * questions that improve a drawing are always the same handful - what view, at what
 * size, in how much detail, for what purpose - so asking two or three of them up front
 * costs one turn and saves the redraw.
 *
 * Deliberately capped. This is a drafting tool, not an interview: past about four
 * questions a draftsman would rather draw it themselves.
 */
export const ASK_QUESTIONS = "ask_questions";

export const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 4;

export const QUESTIONS_TOOL: ToolSpec = {
    name: ASK_QUESTIONS,
    description: [
        "Ask the draftsman up to four short questions before drawing, when the request leaves",
        "something open that would change the drawing itself.",
        "",
        "Worth asking about: which view (plan, elevation, section), overall size or scale, level",
        "of detail, style or standard, what the drawing is for. Not worth asking about: anything",
        "you can reasonably assume, anything the draftsman already said, or preferences that do",
        "not change the geometry. If the request is clear enough to draw, draw it instead.",
    ].join("\n"),
    schema: {
        type: "object",
        properties: {
            questions: {
                type: "array",
                minItems: 1,
                maxItems: MAX_QUESTIONS,
                items: {
                    type: "object",
                    properties: {
                        question: { type: "string", description: "One short question, plainly worded." },
                        options: {
                            type: "array",
                            minItems: 2,
                            maxItems: MAX_OPTIONS,
                            description:
                                "Two to four concrete answers to pick from. The first should be the one " +
                                "you would choose if you had to decide alone.",
                            items: { type: "string" },
                        },
                    },
                    required: ["question", "options"],
                    additionalProperties: false,
                },
            },
        },
        required: ["questions"],
        additionalProperties: false,
    },
};

export interface AiQuestion {
    question: string;
    /** Suggested answers. The draftsman can always type their own instead. */
    options: string[];
}

export function parseQuestions(input: Record<string, unknown>): Result<AiQuestion[], string> {
    const raws = input["questions"];
    if (!Array.isArray(raws) || raws.length === 0) {
        return Result.err("No questions came back.");
    }

    const questions: AiQuestion[] = [];
    for (const raw of raws.slice(0, MAX_QUESTIONS)) {
        const entry = raw as Record<string, unknown>;
        const value = entry["question"];
        const question = typeof value === "string" ? value.trim() : "";
        if (!question) continue;
        const rawOptions = entry["options"];
        const options = Array.isArray(rawOptions)
            ? rawOptions
                  .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
                  .map((o) => o.trim())
                  .slice(0, MAX_OPTIONS)
            : [];
        questions.push({ question, options });
    }

    return questions.length ? Result.ok(questions) : Result.err("No questions came back.");
}

/**
 * Folds the answers back into one user turn.
 *
 * The model asked in its own words, so echoing the question alongside the answer is what
 * keeps "Elevation" meaningful three turns later - and it reads correctly in the panel
 * transcript as something the draftsman said, which is what it is.
 */
export function answersAsText(answered: { question: string; answer: string }[]): string {
    return answered.map(({ question, answer }) => `${question} ${answer}`).join("\n");
}
