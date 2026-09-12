import { LAYER_COLOR_BY_THEME } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { FREEFORM_TOOL, parseFreeform } from "./freeform";

const LAYERS = [{ tag: "OUTLINE", name: "OUTLINE", color: "222222" }];

function draw(items: unknown[], layers: unknown[] = LAYERS) {
    return parseFreeform({ title: "Bracket", layers, items });
}

test("a well-formed drawing comes back as DrawItems", () => {
    const result = draw([
        { kind: "line", layer: "OUTLINE", a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
        { kind: "circle", layer: "OUTLINE", center: { x: 50, y: 50 }, radiusMm: 12 },
        {
            kind: "polyline",
            layer: "OUTLINE",
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
            ],
        },
    ]);

    expect(result.isOk).toBe(true);
    expect(result.value.title).toBe("Bracket");
    expect(result.value.items.map((item) => item.kind)).toEqual(["line", "circle", "polyline"]);
});

test("layer colours are read as hex, and 'theme' means follow the theme", () => {
    const result = draw(
        [{ kind: "line", layer: "A", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }],
        [
            { tag: "A", name: "OUTLINE", color: "#ff8800" },
            { tag: "B", name: "TEXT", color: "theme" },
        ],
    );

    expect(result.value.layers[0].color).toBe(0xff8800);
    expect(result.value.layers[1].color).toBe(LAYER_COLOR_BY_THEME);
});

test("an item on an unknown layer falls back rather than losing the drawing", () => {
    const result = draw([{ kind: "line", layer: "NOPE", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }]);

    expect(result.isOk).toBe(true);
    expect(result.value.items[0].layer).toBe("OUTLINE");
});

test("a quoted number is taken rather than failing the turn", () => {
    const result = draw([{ kind: "circle", layer: "OUTLINE", center: { x: "5", y: 0 }, radiusMm: "12" }]);

    expect(result.isOk).toBe(true);
    expect(result.value.items[0]).toMatchObject({ kind: "circle", center: { x: 5, y: 0 }, radiusMm: 12 });
});

test("rotationDeg defaults to zero when the model leaves it out", () => {
    const result = draw([{ kind: "text", layer: "OUTLINE", at: { x: 0, y: 0 }, text: "A", heightMm: 2.5 }]);

    expect(result.value.items[0]).toMatchObject({ rotationDeg: 0 });
});

test("a malformed item fails the whole call and names its position", () => {
    const result = draw([
        { kind: "line", layer: "OUTLINE", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
        { kind: "circle", layer: "OUTLINE", center: { x: 0, y: 0 } },
    ]);

    expect(result.isOk).toBe(false);
    expect(result.error).toContain("Item 2");
    expect(result.error).toContain("radiusMm");
});

test("a zero sweep is rejected - it would draw nothing", () => {
    const result = draw([
        { kind: "arc", layer: "OUTLINE", center: { x: 0, y: 0 }, start: { x: 1, y: 0 }, sweepDeg: 0 },
    ]);

    expect(result.isOk).toBe(false);
});

test("a polyline of one point is rejected", () => {
    const result = draw([{ kind: "polyline", layer: "OUTLINE", points: [{ x: 0, y: 0 }] }]);

    expect(result.isOk).toBe(false);
});

test("an unknown kind is named in the error rather than silently dropped", () => {
    const result = draw([{ kind: "spline", layer: "OUTLINE" }]);

    expect(result.isOk).toBe(false);
    expect(result.error).toContain("spline");
});

test("an empty drawing and a drawing with no layers both fail", () => {
    expect(draw([]).isOk).toBe(false);
    expect(draw([{ kind: "line", layer: "A", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }], []).isOk).toBe(false);
});

test("the tool schema stays flat, so both providers take it verbatim", () => {
    const properties = FREEFORM_TOOL.schema["properties"] as Record<string, { items: unknown }>;
    const items = (properties["items"].items ?? {}) as Record<string, unknown>;
    expect(items["required"]).toEqual(["kind", "layer"]);
    // A oneOf per kind is the honest shape, but the two providers disagree on how much
    // of it they honour - see the note on ITEM in freeform.ts.
    expect(items["oneOf"]).toBeUndefined();
    expect(items["anyOf"]).toBeUndefined();
});
