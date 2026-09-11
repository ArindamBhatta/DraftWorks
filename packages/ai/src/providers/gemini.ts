import { type Content, FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import { type ConversationTurn, TOOL_ACK } from "../conversation";
import type { AiProvider, ProviderCall, ProviderRequest } from "../provider";
import type { ProviderSettings } from "../settings";

/** Injectable so tests can drive the provider without a network or a key. */
export type GeminiFactory = (settings: ProviderSettings) => GoogleGenAI;

function defaultClient(settings: ProviderSettings): GoogleGenAI {
    return new GoogleGenAI({
        apiKey: settings.apiKey,
        ...(settings.baseURL ? { httpOptions: { baseUrl: settings.baseURL } } : {}),
    });
}

/**
 * Gemini's transcript. Same shape of obligation as Anthropic's - a function call has to
 * be followed by a function response - only spelled differently.
 *
 * The reasoning models add a second obligation: a replayed `functionCall` must carry back
 * the `thoughtSignature` it arrived with, or the request is refused outright with a 400.
 * A call recorded without one therefore cannot be replayed as a call at all - that is what
 * a conversation carried over from the other provider looks like - so it goes back as
 * narration instead, which keeps the history without tripping the check.
 */
export function toContents(turns: ConversationTurn[]): Content[] {
    const contents: Content[] = [];
    for (const turn of turns) {
        if (turn.role === "user") {
            contents.push({ role: "user", parts: [{ text: turn.text }] });
            continue;
        }
        if (!turn.signature) {
            contents.push({ role: "model", parts: [{ text: describeCall(turn.toolName, turn.toolInput) }] });
            contents.push({ role: "user", parts: [{ text: turn.result ?? TOOL_ACK }] });
            continue;
        }
        contents.push({
            role: "model",
            parts: [
                {
                    functionCall: { name: turn.toolName, args: turn.toolInput },
                    thoughtSignature: turn.signature,
                },
            ],
        });
        contents.push({
            role: "user",
            parts: [
                {
                    functionResponse: {
                        name: turn.toolName,
                        response: { output: turn.result ?? TOOL_ACK },
                    },
                },
            ],
        });
    }
    return contents;
}

/** A call the transcript can carry as prose, for when it cannot be carried as a call. */
function describeCall(toolName: string, toolInput: Record<string, unknown>): string {
    return `[Previously called ${toolName} with ${JSON.stringify(toolInput)}]`;
}

export function geminiProvider(createClient: GeminiFactory = defaultClient): AiProvider {
    return {
        id: "gemini",
        label: "Google Gemini",

        async call(request: ProviderRequest): Promise<ProviderCall | undefined> {
            const client = createClient(request.settings);
            const response = await client.models.generateContent({
                model: request.settings.model,
                contents: toContents(request.turns),
                config: {
                    systemInstruction: request.system,
                    // parametersJsonSchema takes ordinary JSON Schema, so the very same
                    // schema goes to both providers - no per-vendor translation to drift.
                    tools: [
                        {
                            functionDeclarations: request.tools.map((tool) => ({
                                name: tool.name,
                                description: tool.description,
                                parametersJsonSchema: tool.schema,
                            })),
                        },
                    ],
                    // ANY is Gemini's spelling of "you must call one of these".
                    toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
                    ...(request.signal ? { abortSignal: request.signal } : {}),
                },
            });

            // Read the part rather than the `functionCalls` shortcut: that returns the calls
            // stripped of the parts they came in, and the signature is on the part.
            const part = response.candidates?.[0]?.content?.parts?.find((p) => p.functionCall?.name);
            const call = part?.functionCall;
            if (!call?.name) return undefined;
            return {
                toolName: call.name,
                toolInput: (call.args ?? {}) as Record<string, unknown>,
                ...(part?.thoughtSignature ? { signature: part.thoughtSignature } : {}),
            };
        },

        describeError(error: unknown, settings: ProviderSettings): string {
            // The Gemini SDK reports failures as one error type carrying an HTTP status,
            // so this reads the status rather than matching on classes.
            const status = (error as { status?: number })?.status;
            const message = error instanceof Error ? error.message : String(error);
            if (status === 400 && /api.?key/i.test(message)) {
                return "That Gemini API key was rejected. Check it in the AI settings.";
            }
            if (status === 401 || status === 403) {
                return "That Gemini API key was rejected, or is not allowed to use this model.";
            }
            if (status === 404) {
                return `Gemini has no model called "${settings.model}". Check which models are available to your account tier at https://ai.google.dev/models - model availability varies by region and billing tier.`;
            }
            if (status === 429) {
                return "Rate limited by Gemini. Wait a moment and ask again.";
            }
            if (status !== undefined && status >= 500) {
                return `Gemini returned a server error (${status}). Try again shortly.`;
            }
            return message;
        },
    };
}
