import { type DrawingMode, floorPlanGenerator, GeneratorRegistry } from "@draftworks/generators";
import { describe, expect, test } from "@rstest/core";
import type { ConversationTurn } from "./conversation";
import { FREEFORM_DRAW } from "./freeform";
import type { AiProvider, ProviderCall, ProviderRequest } from "./provider";
import { ASK_QUESTIONS } from "./questions";
import { route } from "./router";
import type { AiSettings, ProviderId } from "./settings";
import { buildSystemPrompt, buildTools, CANNOT_DRAW, toolFromGenerator } from "./tools";

const registry = new GeneratorRegistry().register(floorPlanGenerator);

const settingsFor = (provider: ProviderId, apiKey = "test-key"): AiSettings => ({
    provider,
    anthropic: { apiKey: provider === "anthropic" ? apiKey : "", model: "claude-opus-5", baseURL: "" },
    gemini: { apiKey: provider === "gemini" ? apiKey : "", model: "gemini-2.5-pro", baseURL: "" },
});

/**
 * A provider that answers with canned calls, and records what it was asked for.
 *
 * Given several answers it hands them out in order, which is what a repair attempt needs:
 * refuse the first drawing, then send a good one and check the router got there.
 */
function stubProvider(id: ProviderId, ...answers: (ProviderCall | undefined | Error)[]): AiProvider {
    const seen: ProviderRequest[] = [];
    const provider: AiProvider & { seen: ProviderRequest[] } = {
        id,
        label: id,
        seen,
        async call(request) {
            seen.push(request);
            const answer = answers[Math.min(seen.length - 1, answers.length - 1)];
            if (answer instanceof Error) throw answer;
            return answer;
        },
        describeError: (error) => `handled: ${(error as Error).message}`,
    };
    return provider;
}

const ask = (
    provider: ProviderId,
    answer: ProviderCall | undefined | Error,
    turns: ConversationTurn[] = [{ role: "user", text: "2BHK on a 30x40 plot" }],
    mode: DrawingMode = "architectural",
) => {
    const stub = stubProvider(provider, answer);
    return {
        stub: stub as AiProvider & { seen: ProviderRequest[] },
        promise: route({
            registry,
            mode,
            turns,
            settings: settingsFor(provider),
            providers: { [provider]: stub },
        }),
    };
};

describe("generators become tools once, for every provider", () => {
    const tool = toolFromGenerator(floorPlanGenerator);

    test("the tool is named after the generator, so picking it is the routing decision", () => {
        expect(tool.name).toBe(floorPlanGenerator.id);
    });

    test("lengths are strings, so the drawing gets to decide what 40 means", () => {
        const properties = tool.schema["properties"] as Record<string, { type: string }>;
        expect(properties["plotWidthMm"].type).toBe("string");
        expect(properties["bedrooms"].type).toBe("integer");
    });

    test("only genuinely required parameters are required", () => {
        expect(tool.schema["required"]).toEqual(["plotWidthMm", "plotDepthMm", "bedrooms"]);
    });

    test("enums carry their allowed values through", () => {
        const properties = tool.schema["properties"] as Record<string, { enum?: string[] }>;
        expect(properties["entrySide"].enum).toEqual(["front", "rear", "left", "right"]);
    });

    test("the schema is plain JSON Schema, which both providers take verbatim", () => {
        expect(tool.schema["type"]).toBe("object");
        expect(tool.schema["additionalProperties"]).toBe(false);
    });

    test("the generators come first, then the general escape hatches", () => {
        expect(buildTools(registry, "architectural").map((t) => t.name)).toEqual([
            floorPlanGenerator.id,
            ASK_QUESTIONS,
            FREEFORM_DRAW,
            CANNOT_DRAW,
        ]);
    });

    test("the system prompt names every drawing registered in that mode", () => {
        expect(buildSystemPrompt(registry, "architectural")).toContain(floorPlanGenerator.id);
    });
});

describe("each mode is a posture, not a filter", () => {
    test("a mode sees only its own drawings", () => {
        expect(buildTools(registry, "structural").map((t) => t.name)).toEqual([
            ASK_QUESTIONS,
            FREEFORM_DRAW,
            CANNOT_DRAW,
        ]);
        expect(buildSystemPrompt(registry, "structural")).not.toContain(floorPlanGenerator.id);
    });

    test("a mode with no generators still draws, rather than having nothing to offer", () => {
        expect(buildTools(registry, "mechanical").map((t) => t.name)).toContain(FREEFORM_DRAW);
        expect(buildSystemPrompt(registry, "mechanical")).toContain("not a reason to decline");
    });

    test("the freehand mode cannot ask questions, because it is given no way to", () => {
        expect(buildTools(registry, "random").map((t) => t.name)).toEqual([FREEFORM_DRAW, CANNOT_DRAW]);
        expect(buildSystemPrompt(registry, "random")).not.toContain(ASK_QUESTIONS);
    });

    test("the technical modes ask before they draw; the freehand mode does not", () => {
        for (const mode of ["architectural", "structural", "mechanical"] as const) {
            expect(buildSystemPrompt(registry, mode)).toContain(ASK_QUESTIONS);
        }
        expect(buildSystemPrompt(registry, "random")).toContain("Do not ask");
    });

    test("the freehand mode is told not to decline a loose or informal request", () => {
        // The bug this mode exists to fix: "draw a woman in the gym" came back as a refusal.
        expect(buildSystemPrompt(registry, "random")).toContain("Do not decline because the request is");
    });

    test("the assistant is never told it is a draftsman - it is told it is talking to one", () => {
        for (const mode of ["architectural", "structural", "mechanical", "random"] as const) {
            expect(buildSystemPrompt(registry, mode)).toContain("you are not one");
        }
    });
});

describe("routing a request", () => {
    for (const provider of ["anthropic", "gemini"] as const) {
        test(`${provider}: a tool call resolves to that generator and its arguments`, async () => {
            const { result } = await ask(provider, {
                toolName: "floor_plan",
                toolInput: { plotWidthMm: "30'", plotDepthMm: "40'", bedrooms: 2 },
            }).promise;
            expect(result.kind).toBe("generator");
            if (result.kind !== "generator") return;
            expect(result.generatorId).toBe("floor_plan");
            expect(result.params["plotWidthMm"]).toBe("30'");
        });

        test(`${provider}: declining is a first-class answer, not a wrong drawing`, async () => {
            const { result } = await ask(provider, {
                toolName: CANNOT_DRAW,
                toolInput: { reason: "I do not draw reinforcement details yet." },
            }).promise;
            expect(result.kind).toBe("cannotDraw");
            if (result.kind !== "cannotDraw") return;
            expect(result.reason).toBe("I do not draw reinforcement details yet.");
        });

        test(`${provider}: the same tools and prompt are sent whichever model is asked`, async () => {
            const { stub, promise } = ask(provider, { toolName: "floor_plan", toolInput: {} });
            await promise;
            expect(stub.seen[0].tools.map((t) => t.name)).toEqual([
                "floor_plan",
                ASK_QUESTIONS,
                FREEFORM_DRAW,
                CANNOT_DRAW,
            ]);
            expect(stub.seen[0].system).toContain("floor_plan");
        });

        test(`${provider}: a thrown error is explained by the provider that threw it`, async () => {
            const { result } = await ask(provider, new Error("boom")).promise;
            expect(result.kind).toBe("error");
            if (result.kind !== "error") return;
            expect(result.message).toBe("handled: boom");
        });

        test(`${provider}: with no key set, nothing is sent and the panel is told what to do`, async () => {
            const stub = stubProvider(provider, undefined);
            const { result } = await route({
                registry,
                mode: "architectural",
                turns: [{ role: "user", text: "2BHK" }],
                settings: settingsFor(provider, "  "),
                providers: { [provider]: stub },
            });
            expect(result.kind).toBe("error");
            if (result.kind !== "error") return;
            expect(result.message).toContain("API key");
            expect((stub as AiProvider & { seen: ProviderRequest[] }).seen).toHaveLength(0);
        });
    }

    test("a tool nobody registered is reported rather than run", async () => {
        const { result } = await ask("anthropic", { toolName: "pile_reinforcement", toolInput: {} }).promise;
        expect(result.kind).toBe("error");
    });

    test("a drawing from another mode is a malformed answer, not a routing choice", async () => {
        const { result } = await ask(
            "anthropic",
            { toolName: "floor_plan", toolInput: { bedrooms: 2 } },
            [{ role: "user", text: "400 dia pile" }],
            "structural",
        ).promise;
        expect(result.kind).toBe("error");
    });

    test("the freehand mode draws what the technical modes would have declined", async () => {
        const { result } = await ask(
            "anthropic",
            {
                toolName: FREEFORM_DRAW,
                toolInput: {
                    title: "Woman lifting weights",
                    layers: [{ tag: "OUTLINE", name: "OUTLINE", color: "theme" }],
                    items: [{ kind: "circle", layer: "OUTLINE", center: { x: 0, y: 0 }, radiusMm: 40 }],
                },
            },
            [{ role: "user", text: "draw a woman in the gym" }],
            "random",
        ).promise;

        expect(result.kind).toBe("freeform");
    });

    test("an answer with no tool call is reported, not silently ignored", async () => {
        const { result } = await ask("anthropic", undefined).promise;
        expect(result.kind).toBe("error");
    });

    test("the model's choice comes back as a turn, so the next question has context", async () => {
        const { result, turn } = await ask("gemini", {
            toolName: "floor_plan",
            toolInput: { bedrooms: 3 },
        }).promise;
        expect(result.kind).toBe("generator");
        expect(turn).toEqual({ role: "call", toolName: "floor_plan", toolInput: { bedrooms: 3 } });
    });

    test("freeform geometry is parsed on the way through, not handed on raw", async () => {
        const { result } = await ask("anthropic", {
            toolName: FREEFORM_DRAW,
            toolInput: {
                title: "Steel bracket",
                layers: [{ tag: "OUTLINE", name: "OUTLINE", color: "theme" }],
                items: [{ kind: "line", layer: "OUTLINE", a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }],
            },
        }).promise;

        expect(result.kind).toBe("freeform");
        if (result.kind !== "freeform") return;
        expect(result.drawing.title).toBe("Steel bracket");
        expect(result.drawing.items).toHaveLength(1);
    });

    test("freeform geometry that will not parse is an error, not a half-drawing", async () => {
        const { result } = await ask("anthropic", {
            toolName: FREEFORM_DRAW,
            toolInput: {
                title: "Broken",
                layers: [{ tag: "OUTLINE", name: "OUTLINE", color: "theme" }],
                items: [{ kind: "circle", layer: "OUTLINE", center: { x: 0, y: 0 } }],
            },
        }).promise;

        expect(result.kind).toBe("error");
    });

    test("questions come back as questions, so the panel can ask before anything is drawn", async () => {
        const { result } = await ask("gemini", {
            toolName: ASK_QUESTIONS,
            toolInput: {
                questions: [{ question: "Which view?", options: ["Plan", "Elevation"] }],
            },
        }).promise;

        expect(result.kind).toBe("questions");
        if (result.kind !== "questions") return;
        expect(result.questions[0].question).toBe("Which view?");
    });

    test("an unusable question list is reported rather than shown as an empty prompt", async () => {
        const { result } = await ask("gemini", { toolName: ASK_QUESTIONS, toolInput: { questions: [] } })
            .promise;

        expect(result.kind).toBe("error");
    });

    test("switching provider keeps the conversation - the history is nobody's SDK type", async () => {
        const history: ConversationTurn[] = [
            { role: "user", text: "2BHK on a 30x40 plot" },
            { role: "call", toolName: "floor_plan", toolInput: { bedrooms: 2 } },
            { role: "user", text: "make it 3BHK" },
        ];
        const { stub, promise } = ask(
            "gemini",
            { toolName: "floor_plan", toolInput: { bedrooms: 3 } },
            history,
        );
        await promise;
        expect(stub.seen[0].turns).toEqual(history);
    });
});

describe("refused geometry is repaired rather than shown to the draftsman", () => {
    const wheel = (radiusMm?: number): ProviderCall => ({
        toolName: FREEFORM_DRAW,
        toolInput: {
            title: "Wheel",
            layers: [{ tag: "OUTLINE", name: "OUTLINE", color: "theme" }],
            items: [
                {
                    kind: "circle",
                    layer: "OUTLINE",
                    center: { x: 0, y: 0 },
                    ...(radiusMm ? { radiusMm } : {}),
                },
            ],
        },
    });

    const draw = (...answers: (ProviderCall | undefined | Error)[]) => {
        const stub = stubProvider("anthropic", ...answers) as AiProvider & { seen: ProviderRequest[] };
        return {
            stub,
            promise: route({
                registry,
                mode: "random",
                turns: [{ role: "user", text: "draw a wheel" }],
                settings: settingsFor("anthropic"),
                providers: { anthropic: stub },
            }),
        };
    };

    test("a circle with no radius is sent back, and the corrected drawing is the one drawn", async () => {
        const { stub, promise } = draw(wheel(), wheel(40));
        const { result } = await promise;

        expect(result.kind).toBe("freeform");
        expect(stub.seen).toHaveLength(2);
    });

    test("the repair attempt is told which field was missing", async () => {
        const { stub, promise } = draw(wheel(), wheel(40));
        await promise;

        const retried = stub.seen[1].turns.at(-1);
        expect(retried?.role).toBe("call");
        if (retried?.role !== "call") return;
        expect(retried.result).toContain("radiusMm");
        expect(retried.toolInput).toEqual(wheel().toolInput);
    });

    test("the repair attempt replays the token the refused call arrived with", async () => {
        // Without this the retry is the request Gemini 400s on, which is how the repair
        // loop turned a latent transcript bug into one that fired on the first drawing.
        const { stub, promise } = draw({ ...wheel(), signature: "sig-1" }, wheel(40));
        await promise;

        const retried = stub.seen[1].turns.at(-1);
        expect(retried?.role === "call" && retried.signature).toBe("sig-1");
    });

    test("a drawing that parses is never sent back - one good turn is one round-trip", async () => {
        const { stub, promise } = draw(wheel(40));
        const { result } = await promise;

        expect(result.kind).toBe("freeform");
        expect(stub.seen).toHaveLength(1);
    });

    test("refused twice, the draftsman is told plainly rather than shown the parser", async () => {
        const { stub, promise } = draw(wheel(), wheel());
        const { result, turn } = await promise;

        expect(stub.seen).toHaveLength(2);
        expect(result.kind).toBe("error");
        if (result.kind !== "error") return;
        // The parser names an item index and a field; that is for the model, not the person.
        expect(result.message).toContain("twice over");
        expect(result.message).toContain("Ask again");
        // The refusal still reaches the history, so asking again does not repeat it blind.
        expect(turn?.role === "call" && turn.result).toContain("radiusMm");
    });
});
