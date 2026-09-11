import type { ConversationTurn, ToolSpec } from "./conversation";
import type { ProviderId, ProviderSettings } from "./settings";

export interface ProviderRequest {
    system: string;
    tools: ToolSpec[];
    turns: ConversationTurn[];
    settings: ProviderSettings;
    signal?: AbortSignal;
}

/** The one thing a provider has to produce: which drawing, with what arguments. */
export interface ProviderCall {
    toolName: string;
    toolInput: Record<string, unknown>;
    /**
     * An opaque token the provider issued with this call and requires back verbatim if the
     * call is ever replayed. Meaningless to this app - never read it, only carry it.
     */
    signature?: string;
}

/**
 * A model that can read a request and pick a drawing.
 *
 * The surface is deliberately this narrow. Everything that decides what gets drawn -
 * the tool schemas, the system prompt, the conversation - is provider-neutral and lives
 * outside; a provider only translates that into one vendor's request shape and reads
 * one tool call back out. So adding a third model is one file, and no provider can
 * quietly change what the app is capable of drawing.
 */
export interface AiProvider {
    id: ProviderId;
    label: string;
    /** Returns undefined when the model answered without choosing a drawing. */
    call(request: ProviderRequest): Promise<ProviderCall | undefined>;
    /**
     * Turns a thrown error into a sentence for the panel. Most specific first, and
     * given the settings so it can quote the model or endpoint that failed.
     */
    describeError(error: unknown, settings: ProviderSettings): string;
}
