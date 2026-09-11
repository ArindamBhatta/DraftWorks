/**
 * A drawing tool as the model sees it, in a shape neither provider owns.
 *
 * `schema` is ordinary JSON Schema. Anthropic takes it as `input_schema` and Gemini as
 * `parametersJsonSchema`, both verbatim - so there is one schema per generator rather
 * than one per generator per provider, and nothing can drift between them.
 */
export interface ToolSpec {
    name: string;
    description: string;
    schema: Record<string, unknown>;
}

/**
 * The conversation, kept in the app's own terms rather than any SDK's.
 *
 * Only two things ever happen: the draftsman says something, or the model picks a
 * drawing. Each provider expands that into its own transcript format - which for both
 * of them means inventing a tool-result turn, since neither will accept a tool call
 * left unanswered. Keeping the neutral form means the panel never imports an SDK type
 * and switching provider mid-conversation loses nothing.
 */
export type ConversationTurn =
    | { role: "user"; text: string }
    | {
          role: "call";
          toolName: string;
          toolInput: Record<string, unknown>;
          /**
           * What the app told the model came of the call. Left unset for the usual case -
           * it drew, and there is nothing to report. Set when the call was refused, which
           * is the only way a model ever learns its geometry was unusable: without it the
           * transcript says every drawing succeeded, and the same malformed circle comes
           * back on the next turn.
           */
          result?: string;
          /**
           * An opaque token from the provider that issued the call, kept only so it can be
           * handed back when the call is replayed. Gemini's reasoning models require theirs
           * and reject a transcript without it; Anthropic ignores the field. It is not
           * portable - a token from one provider means nothing to another - so a
           * conversation that changes provider mid-way leaves it behind.
           */
          signature?: string;
      };

/** What the app tells the model happened after a tool call. It draws; there is no result. */
export const TOOL_ACK = "The drawing was produced by the application.";

/** Prefixes the reason a call was refused, so the model can tell it apart from an ack. */
export const TOOL_REJECTED = "Nothing was drawn - that drawing was refused.";
