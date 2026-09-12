import type { DrawingMode, GeneratorRegistry } from "@draftworks/generators";
import { type ConversationTurn, TOOL_REJECTED } from "./conversation";
import { FREEFORM_DRAW, type FreeformDrawing, parseFreeform } from "./freeform";
import type { AiProvider } from "./provider";
import { type AiQuestion, ASK_QUESTIONS, parseQuestions } from "./questions";
import { type AiSettings, PROVIDER_LABELS, type ProviderId } from "./settings";
import { buildSystemPrompt, buildTools, CANNOT_DRAW } from "./tools";

export type RouterResult =
    | { kind: "generator"; generatorId: string; params: Record<string, unknown> }
    | { kind: "freeform"; drawing: FreeformDrawing }
    | { kind: "questions"; questions: AiQuestion[] }
    | { kind: "cannotDraw"; reason: string }
    | { kind: "error"; message: string };

export interface RouteOptions {
    registry: GeneratorRegistry;
    /**
     * Which tab asked. It picks the tools, the prompt and the posture - whether the model
     * is expected to ask before drawing, and how readily it may decline.
     */
    mode: DrawingMode;
    /** The conversation so far, ending with the draftsman's new message. */
    turns: ConversationTurn[];
    settings: AiSettings;
    signal?: AbortSignal;
    /** Injectable for tests; defaults to the real provider for the selected model. */
    providers?: Partial<Record<ProviderId, AiProvider>>;
}

/**
 * How many times a refused drawing is handed back to be corrected.
 *
 * One. A model that cannot produce a well-formed circle when told exactly which field was
 * missing will not manage it on the third try either, and every attempt is a round-trip
 * the draftsman waits through.
 */
const REPAIR_ATTEMPTS = 1;

export interface RouteResponse {
    result: RouterResult;
    /** The model's choice, to append to the conversation before the next request. */
    turn?: ConversationTurn;
}

/**
 * Loads a provider's SDK on demand.
 *
 * Both vendor SDKs together are larger than the rest of the application, and most
 * sessions never open the AI panel at all - so they are separate chunks, fetched when
 * a drawing is actually asked for, and only for the provider selected.
 */
export async function providerFor(id: ProviderId): Promise<AiProvider> {
    if (id === "gemini") {
        const { geminiProvider } = await import("./providers/gemini");
        return geminiProvider();
    }
    const { anthropicProvider } = await import("./providers/anthropic");
    return anthropicProvider();
}

/**
 * Reads the request and decides what happens: a generator, a set of questions, geometry
 * emitted directly, or a refusal.
 *
 * For a generator, choosing the tool *is* the routing decision and its arguments are the
 * generator's parameters, so the worst a bad turn can do is pick the wrong drawing or the
 * wrong plot size. Freeform is the looser path - there the model does produce coordinates,
 * and `parseFreeform` is what stands between a bad turn and the document. Neither can
 * reach the canvas without passing the preview the draftsman sees first.
 */
export async function route(options: RouteOptions): Promise<RouteResponse> {
    const { registry, mode, turns, settings } = options;
    const credentials = settings[settings.provider];

    // Checked before the SDK is fetched: a missing key needs no network and no download.
    if (!credentials.apiKey.trim()) {
        const label = PROVIDER_LABELS[settings.provider];
        return {
            result: {
                kind: "error",
                message: `Add a ${label} API key in the AI settings before asking for a drawing.`,
            },
        };
    }

    const provider = options.providers?.[settings.provider] ?? (await providerFor(settings.provider));
    const request = {
        system: buildSystemPrompt(registry, mode),
        tools: buildTools(registry, mode),
        settings: credentials,
        signal: options.signal,
    };

    // The transcript this attempt sees. Refused geometry is appended to it rather than
    // thrown away, so the repair attempt reads back both what it sent and why it bounced.
    const attempted: ConversationTurn[] = [...turns];
    let refusal: { turn: ConversationTurn; error: string } | undefined;

    for (let attempt = 0; attempt <= REPAIR_ATTEMPTS; attempt++) {
        let call: Awaited<ReturnType<AiProvider["call"]>>;
        try {
            call = await provider.call({ ...request, turns: attempted });
        } catch (error) {
            return { result: { kind: "error", message: provider.describeError(error, credentials) } };
        }

        if (!call) {
            return {
                result: {
                    kind: "error",
                    message: `${provider.label} did not choose a drawing. Try describing it again.`,
                },
            };
        }

        const turn: ConversationTurn = {
            role: "call",
            toolName: call.toolName,
            toolInput: call.toolInput,
            // Carried, never read: some providers refuse a replayed call that arrives
            // without the token they issued with it.
            ...(call.signature ? { signature: call.signature } : {}),
        };

        if (call.toolName === CANNOT_DRAW) {
            const reason = readString(call.toolInput, "reason") ?? "That is not something I can draw yet.";
            return { result: { kind: "cannotDraw", reason }, turn };
        }

        if (call.toolName === ASK_QUESTIONS) {
            const questions = parseQuestions(call.toolInput);
            // A malformed question list is not worth surfacing as an error - there is nothing
            // for the draftsman to do about it. Falling through to a plain retry is kinder.
            if (!questions.isOk) {
                return {
                    result: { kind: "error", message: `${provider.label} did not ask a usable question.` },
                    turn,
                };
            }
            return { result: { kind: "questions", questions: questions.value }, turn };
        }

        if (call.toolName === FREEFORM_DRAW) {
            const drawing = parseFreeform(call.toolInput);
            if (drawing.isOk) return { result: { kind: "freeform", drawing: drawing.value }, turn };

            // One bad item refuses the whole drawing, and the parser's message names a field
            // on an item the draftsman cannot see - so it is aimed at the model, which can
            // fix it, rather than at the person, who cannot. Only the last refusal is kept
            // in the history: two malformed attempts would just anchor the next turn.
            refusal = {
                turn: { ...turn, result: `${TOOL_REJECTED} ${drawing.error}` },
                error: drawing.error,
            };
            attempted.push(refusal.turn);
            continue;
        }

        // Checked against the mode, not just the registry: a tab is only ever offered its own
        // drawings, so a name from another one is a malformed answer rather than a routing choice.
        if (registry.get(call.toolName)?.mode !== mode) {
            return { result: { kind: "error", message: `Unknown drawing "${call.toolName}".` }, turn };
        }

        return {
            result: { kind: "generator", generatorId: call.toolName, params: call.toolInput },
            turn,
        };
    }

    return {
        result: {
            kind: "error",
            message:
                `${provider.label} sent geometry the drawing could not use, twice over. Ask again, ` +
                `or describe it in a little more detail. (${refusal?.error ?? ""})`.trim(),
        },
        turn: refusal?.turn,
    };
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
    const value = input[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
