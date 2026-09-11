import Anthropic from "@anthropic-ai/sdk";
import { type ConversationTurn, TOOL_ACK } from "../conversation";
import type { AiProvider, ProviderCall, ProviderRequest } from "../provider";
import type { ProviderSettings } from "../settings";

/** Injectable so tests can drive the provider without a network or a key. */
export type AnthropicFactory = (settings: ProviderSettings) => Anthropic;

function defaultClient(settings: ProviderSettings): Anthropic {
    return new Anthropic({
        apiKey: settings.apiKey,
        ...(settings.baseURL ? { baseURL: settings.baseURL } : {}),
        // There is no server to put the key behind - see the note in settings.ts.
        dangerouslyAllowBrowser: true,
    });
}

/**
 * Anthropic's transcript. A tool call must be answered by a tool_result or the next
 * request is rejected, so each recorded call expands into the pair - the app does the
 * drawing, so the "result" is only an acknowledgement.
 */
export function toMessages(turns: ConversationTurn[]): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];
    turns.forEach((turn, index) => {
        if (turn.role === "user") {
            messages.push({ role: "user", content: turn.text });
            return;
        }
        const id = `toolu_${index}`;
        messages.push({
            role: "assistant",
            content: [{ type: "tool_use", id, name: turn.toolName, input: turn.toolInput }],
        });
        messages.push({
            role: "user",
            content: [{ type: "tool_result", tool_use_id: id, content: turn.result ?? TOOL_ACK }],
        });
    });
    return messages;
}

export function anthropicProvider(createClient: AnthropicFactory = defaultClient): AiProvider {
    return {
        id: "anthropic",
        label: "Anthropic Claude",

        async call(request: ProviderRequest): Promise<ProviderCall | undefined> {
            const client = createClient(request.settings);
            const response = await client.messages.create(
                {
                    model: request.settings.model,
                    // Routing needs a tool call and nothing else, but leave headroom: an
                    // undersized cap truncates the arguments and wastes the whole turn.
                    max_tokens: 4096,
                    system: request.system,
                    tools: request.tools.map((tool) => ({
                        name: tool.name,
                        description: tool.description,
                        input_schema: tool.schema as Anthropic.Tool.InputSchema,
                    })),
                    tool_choice: { type: "any" },
                    messages: toMessages(request.turns),
                },
                { signal: request.signal },
            );

            const call = response.content.find((block) => block.type === "tool_use");
            if (!call || call.type !== "tool_use") return undefined;
            // Tool inputs are JSON from the model; never string-matched.
            return { toolName: call.name, toolInput: (call.input ?? {}) as Record<string, unknown> };
        },

        describeError(error: unknown, settings: ProviderSettings): string {
            if (error instanceof Anthropic.AuthenticationError) {
                return "That Anthropic API key was rejected. Check it in the AI settings.";
            }
            if (error instanceof Anthropic.PermissionDeniedError) {
                return "That Anthropic API key is not allowed to use this model.";
            }
            if (error instanceof Anthropic.RateLimitError) {
                return "Rate limited by Anthropic. Wait a moment and ask again.";
            }
            if (error instanceof Anthropic.NotFoundError) {
                return `Anthropic has no model called "${settings.model}". Use the API model id, such as "claude-opus-5".`;
            }
            if (error instanceof Anthropic.APIConnectionError) {
                return "Could not reach Anthropic. Check the network, or set a proxy URL in the AI settings.";
            }
            if (error instanceof Anthropic.APIError) {
                return `Anthropic returned an error (${error.status ?? "unknown"}): ${error.message}`;
            }
            return error instanceof Error ? error.message : String(error);
        },
    };
}
