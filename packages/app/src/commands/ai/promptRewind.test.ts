import type { ConversationTurn } from "@draftworks/ai";
import { describe, expect, test } from "@rstest/core";
import { turnsBefore } from "./aiPanel";

const user = (text: string): ConversationTurn => ({ role: "user", text });
const call = (toolName: string): ConversationTurn => ({ role: "call", toolName, toolInput: {} });

describe("turnsBefore", () => {
    test("editing the first prompt rewinds to an empty transcript", () => {
        const turns = [user("2BHK on 30x40"), call("floorPlan")];
        expect(turnsBefore(turns, 0)).toBe(0);
    });

    test("cuts before the nth prompt, not the nth turn", () => {
        // Two prompts, but four turns - the call turns sit between them, which is why
        // position and prompt number cannot be used interchangeably.
        const turns = [user("2BHK"), call("floorPlan"), user("make it 3BHK"), call("floorPlan")];
        expect(turnsBefore(turns, 1)).toBe(2);
    });

    test("keeps answered questions with the prompt that provoked them", () => {
        // A round of chips sends a user turn of its own; editing the prompt above it has
        // to take that answer with it, or the model reads an answer to a dropped question.
        const turns = [user("a staircase"), user("Treads: 12"), call("stair"), user("wider")];
        expect(turnsBefore(turns, 2)).toBe(3);
    });

    test("an index past the end leaves the transcript whole", () => {
        // A prompt that never produced a turn - no API key, or a failure before the call.
        const turns = [user("2BHK"), call("floorPlan")];
        expect(turnsBefore(turns, 5)).toBe(2);
    });

    test("an empty transcript has nothing to cut", () => {
        expect(turnsBefore([], 0)).toBe(0);
        expect(turnsBefore([], 3)).toBe(0);
    });
});
