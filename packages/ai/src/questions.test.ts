import { expect, test } from "@rstest/core";
import { answersAsText, MAX_OPTIONS, MAX_QUESTIONS, parseQuestions } from "./questions";

test("questions and their options come back in order", () => {
    const result = parseQuestions({
        questions: [
            { question: "Which view?", options: ["Plan", "Elevation", "Section"] },
            { question: "What scale?", options: ["1:50", "1:100"] },
        ],
    });

    expect(result.isOk).toBe(true);
    expect(result.value).toHaveLength(2);
    expect(result.value[0].options).toEqual(["Plan", "Elevation", "Section"]);
});

test("more than the cap is trimmed rather than rejected", () => {
    const questions = Array.from({ length: 9 }, (_, i) => ({
        question: `Q${i}`,
        options: Array.from({ length: 9 }, (_, j) => `O${j}`),
    }));

    const result = parseQuestions({ questions });

    expect(result.value).toHaveLength(MAX_QUESTIONS);
    expect(result.value[0].options).toHaveLength(MAX_OPTIONS);
});

test("a question with no usable options still stands - the box below can answer it", () => {
    const result = parseQuestions({ questions: [{ question: "How wide?", options: [] }] });

    expect(result.isOk).toBe(true);
    expect(result.value[0].options).toEqual([]);
});

test("blank questions are dropped, and a list of only blanks fails", () => {
    const mixed = parseQuestions({
        questions: [{ question: "  " }, { question: "Real?", options: ["Yes"] }],
    });
    expect(mixed.value).toHaveLength(1);

    expect(parseQuestions({ questions: [{ question: "" }] }).isOk).toBe(false);
    expect(parseQuestions({ questions: [] }).isOk).toBe(false);
    expect(parseQuestions({}).isOk).toBe(false);
});

test("answers carry their question, so a bare 'Elevation' still means something later", () => {
    const text = answersAsText([
        { question: "Which view?", answer: "Elevation" },
        { question: "What scale?", answer: "1:50" },
    ]);

    expect(text).toBe("Which view? Elevation\nWhat scale? 1:50");
});
