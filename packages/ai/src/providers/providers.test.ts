import Anthropic from "@anthropic-ai/sdk";
import type { GoogleGenAI, Part } from "@google/genai";
import { describe, expect, test } from "@rstest/core";
import { type ConversationTurn, TOOL_ACK, type ToolSpec } from "../conversation";
import type { ProviderRequest } from "../provider";
import { anthropicProvider, toMessages } from "./anthropic";
import { geminiProvider, toContents } from "./gemini";

const TOOLS: ToolSpec[] = [
    { name: "floor_plan", description: "a plan", schema: { type: "object", properties: {} } },
];

const HISTORY: ConversationTurn[] = [
    { role: "user", text: "2BHK on a 30x40 plot" },
    // Signed, as a call recorded from a live provider is. Anthropic ignores the token;
    // Gemini needs it back, and the unsigned case has a test of its own below.
    { role: "call", toolName: "floor_plan", toolInput: { bedrooms: 2 }, signature: "sig-history" },
    { role: "user", text: "make it 3BHK" },
];

const request = (turns: ConversationTurn[] = HISTORY): ProviderRequest => ({
    system: "you draw things",
    tools: TOOLS,
    turns,
    settings: { apiKey: "k", model: "test-model", baseURL: "" },
});

describe("the neutral conversation expands into each vendor's transcript", () => {
    test("Anthropic answers every tool call, because an unanswered one is rejected", () => {
        const messages = toMessages(HISTORY);
        expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "user"]);

        const call = messages[1].content as Anthropic.ContentBlockParam[];
        expect(call[0].type).toBe("tool_use");

        const answer = messages[2].content as Anthropic.ContentBlockParam[];
        expect(answer[0].type).toBe("tool_result");
        // The ids must match or the request is rejected.
        expect((answer[0] as { tool_use_id: string }).tool_use_id).toBe((call[0] as { id: string }).id);
    });

    test("Gemini does the same thing in its own words", () => {
        const contents = toContents(HISTORY);
        expect(contents.map((c) => c.role)).toEqual(["user", "model", "user", "user"]);
        expect(contents[1].parts?.[0].functionCall?.name).toBe("floor_plan");
        expect(contents[2].parts?.[0].functionResponse?.response).toEqual({ output: TOOL_ACK });
    });

    test("a conversation of plain messages needs no tool turns at all", () => {
        const plain: ConversationTurn[] = [{ role: "user", text: "hello" }];
        expect(toMessages(plain)).toHaveLength(1);
        expect(toContents(plain)).toHaveLength(1);
    });

    test("a refused call carries its reason back, so the model can see what bounced", () => {
        const refused: ConversationTurn[] = [
            { role: "user", text: "draw a wheel" },
            {
                role: "call",
                toolName: "freeform_draw",
                toolInput: {},
                result: "Nothing was drawn - Item 4: a circle needs a positive `radiusMm`.",
                signature: "sig-refused",
            },
        ];

        const answer = toMessages(refused)[2].content as Anthropic.ContentBlockParam[];
        expect((answer[0] as { content: string }).content).toContain("radiusMm");
        expect(toContents(refused)[2].parts?.[0].functionResponse?.response).toEqual({
            output: refused[1].role === "call" ? refused[1].result : "",
        });
    });
});

describe("Anthropic requests", () => {
    const capture = () => {
        const calls: Anthropic.MessageCreateParams[] = [];
        const client = {
            messages: {
                create: async (params: Anthropic.MessageCreateParams) => {
                    calls.push(params);
                    return {
                        content: [{ type: "tool_use", id: "t1", name: "floor_plan", input: { bedrooms: 2 } }],
                    } as Anthropic.Message;
                },
            },
        };
        return { calls, provider: anthropicProvider(() => client as unknown as Anthropic) };
    };

    test("a tool call is forced, so the model cannot answer with prose instead", async () => {
        const { calls, provider } = capture();
        await provider.call(request());
        expect(calls[0].tool_choice).toEqual({ type: "any" });
    });

    test("the model and schema go through untouched", async () => {
        const { calls, provider } = capture();
        await provider.call(request());
        expect(calls[0].model).toBe("test-model");
        expect(calls[0].tools?.[0]).toMatchObject({ name: "floor_plan", input_schema: TOOLS[0].schema });
    });

    test("the chosen tool and its arguments come back", async () => {
        const { provider } = capture();
        expect(await provider.call(request())).toEqual({
            toolName: "floor_plan",
            toolInput: { bedrooms: 2 },
        });
    });
});

describe("Gemini requests", () => {
    /**
     * Answers the way the SDK really does: the calls live in the candidate's parts, and
     * `functionCalls` is only a view over them that drops the part it came in.
     */
    const capture = (parts: Part[] = []) => {
        const calls: Record<string, unknown>[] = [];
        const client = {
            models: {
                generateContent: async (params: Record<string, unknown>) => {
                    calls.push(params);
                    return {
                        candidates: [{ content: { parts } }],
                        functionCalls: parts.flatMap((p) => (p.functionCall ? [p.functionCall] : [])),
                    };
                },
            },
        };
        return { calls, provider: geminiProvider(() => client as unknown as GoogleGenAI) };
    };

    test("ANY mode is Gemini's spelling of a forced tool call", async () => {
        const { calls, provider } = capture();
        await provider.call(request());
        const config = calls[0]["config"] as { toolConfig: { functionCallingConfig: { mode: string } } };
        expect(config.toolConfig.functionCallingConfig.mode).toBe("ANY");
    });

    test("the very same JSON Schema is sent - no per-vendor translation to drift", async () => {
        const { calls, provider } = capture();
        await provider.call(request());
        const config = calls[0]["config"] as {
            tools: { functionDeclarations: { name: string; parametersJsonSchema: unknown }[] }[];
        };
        expect(config.tools[0].functionDeclarations[0].parametersJsonSchema).toBe(TOOLS[0].schema);
        expect(config.tools[0].functionDeclarations[0].name).toBe("floor_plan");
    });

    test("the system prompt rides in systemInstruction", async () => {
        const { calls, provider } = capture();
        await provider.call(request());
        expect((calls[0]["config"] as { systemInstruction: string }).systemInstruction).toBe(
            "you draw things",
        );
    });

    test("the chosen function and its arguments come back", async () => {
        const { provider } = capture([{ functionCall: { name: "floor_plan", args: { bedrooms: 3 } } }]);
        expect(await provider.call(request())).toEqual({
            toolName: "floor_plan",
            toolInput: { bedrooms: 3 },
        });
    });

    test("an answer with no function call is reported as such", async () => {
        const { provider } = capture([]);
        expect(await provider.call(request())).toBeUndefined();
    });

    test("the thought signature is picked up off the part, not lost with the shortcut", async () => {
        const { provider } = capture([
            { functionCall: { name: "floor_plan", args: {} }, thoughtSignature: "Cs4BAbc123" },
        ]);
        expect(await provider.call(request())).toEqual({
            toolName: "floor_plan",
            toolInput: {},
            signature: "Cs4BAbc123",
        });
    });

    test("a replayed call carries its signature back, which the reasoning models require", () => {
        const signed: ConversationTurn[] = [
            { role: "user", text: "draw a wheel" },
            { role: "call", toolName: "freeform_draw", toolInput: { title: "Wheel" }, signature: "sig-1" },
        ];
        const parts = toContents(signed)[1].parts;
        expect(parts?.[0].functionCall?.name).toBe("freeform_draw");
        expect(parts?.[0].thoughtSignature).toBe("sig-1");
    });

    test("a call with no signature is narrated instead - replaying it would be a 400", () => {
        // What a conversation started on the other provider looks like.
        const unsigned: ConversationTurn[] = [
            { role: "user", text: "draw a wheel" },
            { role: "call", toolName: "freeform_draw", toolInput: { title: "Wheel" } },
        ];
        const contents = toContents(unsigned);
        expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
        expect(contents[1].parts?.[0].functionCall).toBeUndefined();
        expect(contents[1].parts?.[0].text).toContain("freeform_draw");
        expect(contents[2].parts?.[0].text).toBe(TOOL_ACK);
    });
});

describe("failures are explained rather than dumped", () => {
    const settings = { apiKey: "k", model: "Gemini2.5 Pro", baseURL: "" };

    test("Gemini reads the HTTP status", () => {
        const provider = geminiProvider();
        expect(provider.describeError({ status: 429, message: "quota" }, settings)).toContain("Rate limited");
        expect(provider.describeError({ status: 403, message: "denied" }, settings)).toContain("rejected");
    });

    test("a 404 quotes the model that failed and directs to the model list", () => {
        const message = geminiProvider().describeError({ status: 404, message: "nope" }, settings);
        expect(message).toContain('"Gemini2.5 Pro"');
        expect(message).toContain("ai.google.dev/models");

        const anthropic = anthropicProvider().describeError(
            new Anthropic.NotFoundError(404, undefined, "not found", new Headers()),
            { ...settings, model: "Claude Opus 5" },
        );
        expect(anthropic).toContain('"Claude Opus 5"');
        expect(anthropic).toContain("claude-opus-5");
    });

    test("an error nobody recognises still reaches the draftsman", () => {
        expect(geminiProvider().describeError(new Error("something odd"), settings)).toBe("something odd");
        expect(anthropicProvider().describeError(new Error("something odd"), settings)).toBe("something odd");
    });
});
