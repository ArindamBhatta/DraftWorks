import { buildDrawing, DEFAULT_SPEC, type DrawItem, generateFloorPlan } from "@draftworks/generators";
import { describe, expect, test } from "@rstest/core";
import { renderPreview } from "./aiPreview";

const plan = (): DrawItem[] => {
    const ir = generateFloorPlan(DEFAULT_SPEC as never);
    expect(ir.isOk, JSON.stringify(ir.error)).toBe(true);
    return buildDrawing(ir.value, { format: (mm) => String(Math.round(mm)), parseLength: Number });
};

describe("the preview draws the same list the document will get", () => {
    const items = plan();
    const svg = renderPreview(items);

    test("every drawn item reaches the preview", () => {
        const drawn =
            svg.querySelectorAll("line").length +
            svg.querySelectorAll("path").length +
            svg.querySelectorAll("text").length;
        expect(drawn).toBe(items.length);
    });

    test("door swings become arc paths, not straight lines", () => {
        const arcs = [...svg.querySelectorAll("path")].filter((p) => p.getAttribute("d")?.includes("A "));
        expect(arcs.length).toBe(items.filter((i) => i.kind === "arc").length);
        expect(arcs.length).toBeGreaterThan(0);
    });

    test("room labels are readable, not mirrored", () => {
        // Y is negated per coordinate rather than by flipping the group, precisely so the
        // text stays upright; a flip transform would render every label backwards.
        const texts = [...svg.querySelectorAll("text")];
        expect(texts.length).toBeGreaterThan(0);
        expect(svg.getAttribute("transform")).toBeNull();
        for (const text of texts) {
            expect(Number(text.getAttribute("font-size"))).toBeGreaterThan(0);
        }
    });

    test("the viewBox frames the drawing with the Y axis turned over", () => {
        const [x, y, w, h] = svg.getAttribute("viewBox")!.split(" ").map(Number);
        const xs = items.flatMap((i) => (i.kind === "line" ? [i.a.x, i.b.x] : []));
        const ys = items.flatMap((i) => (i.kind === "line" ? [i.a.y, i.b.y] : []));
        expect(x).toBeLessThanOrEqual(Math.min(...xs));
        expect(x + w).toBeGreaterThanOrEqual(Math.max(...xs));
        // In SVG the top of the plan is the most negative Y.
        expect(y).toBeLessThanOrEqual(-Math.max(...ys));
        expect(y + h).toBeGreaterThanOrEqual(-Math.min(...ys));
    });
});

test("a tall plot gives a tall preview, not a squashed one", () => {
    const svg = renderPreview(plan(), undefined, 300);
    const width = Number(svg.getAttribute("width"));
    const height = Number(svg.getAttribute("height"));
    // The default plot is 30 x 40, so the preview is taller than it is wide.
    expect(height).toBe(300);
    expect(width).toBeLessThan(height);
});

test("an empty drawing renders an empty figure rather than throwing", () => {
    const svg = renderPreview([]);
    expect(svg.childElementCount).toBe(0);
    expect(svg.getAttribute("viewBox")).toBeTruthy();
});

describe("the preview draws whatever the model emitted, on its own layers", () => {
    const layers = [
        { tag: "OUTLINE", name: "OUTLINE", color: 0x223344 },
        { tag: "GUIDE", name: "GUIDE", color: -1 },
    ];
    const items: DrawItem[] = [
        { kind: "circle", layer: "OUTLINE", center: { x: 0, y: 0 }, radiusMm: 10 },
        {
            kind: "ellipse",
            layer: "OUTLINE",
            center: { x: 0, y: 0 },
            radiusXMm: 8,
            radiusYMm: 4,
            rotationDeg: 30,
        },
        {
            kind: "polyline",
            layer: "GUIDE",
            points: [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
                { x: 10, y: 0 },
            ],
            closed: false,
        },
        {
            kind: "polyline",
            layer: "GUIDE",
            points: [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
                { x: 10, y: 0 },
            ],
            closed: true,
        },
    ];
    const svg = renderPreview(items, layers);

    test("each new primitive gets its own SVG element", () => {
        expect(svg.querySelectorAll("circle")).toHaveLength(1);
        expect(svg.querySelectorAll("ellipse")).toHaveLength(1);
        expect(svg.querySelectorAll("polyline")).toHaveLength(1);
        expect(svg.querySelectorAll("polygon")).toHaveLength(1);
    });

    test("a closed run becomes a polygon and an open one does not", () => {
        expect(svg.querySelector("polygon")?.getAttribute("points")).toBe("0,0 5,-5 10,0");
        expect(svg.querySelector("polyline")?.getAttribute("points")).toBe("0,0 5,-5 10,0");
    });

    test("a model-named layer keeps its own colour", () => {
        expect(svg.querySelector("circle")?.getAttribute("stroke")).toBe("#223344");
    });

    test("a theme-following layer draws in the panel's own colour", () => {
        expect(svg.querySelector("polyline")?.getAttribute("stroke")).toBe("currentColor");
    });

    test("the rotation reverses with the mirrored Y axis, so the ellipse leans the right way", () => {
        expect(svg.querySelector("ellipse")?.getAttribute("transform")).toContain("rotate(-30");
    });
});
