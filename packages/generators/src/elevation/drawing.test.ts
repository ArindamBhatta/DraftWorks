import { describe, expect, test } from "@rstest/core";
import { DEFAULT_SPEC } from "../floorPlan/defaults";
import { buildDrawing } from "../floorPlan/drawing";
import { generateFloorPlan } from "../floorPlan/generator";
import { type FloorPlanSpec, wallPoint } from "../floorPlan/plan";
import type { GeneratorContext } from "../registry";
import { boundsOf, type DrawItem } from "../types";
import { buildElevation, levelsOf, openingsAt, placementBelow, translateItems } from "./drawing";
import { extractFacade, type Facade } from "./facade";
import { coerceElevation, DEFAULT_ELEVATION, type ElevationSpec, summarizeElevation } from "./spec";

const ctx: GeneratorContext = { format: (mm) => String(Math.round(mm)), parseLength: Number };

/** A 6 m facade with a 1 m door at 1500 and a 1.2 m window at 4000. */
const facade: Facade = {
    side: "south",
    widthMm: 6000,
    wallThicknessMm: 230,
    openings: [
        { kind: "door", centerMm: 1500, widthMm: 1000, hinge: "left" },
        { kind: "window", centerMm: 4000, widthMm: 1200 },
    ],
    origin: { x: 0, y: 0 },
    unpairedJambs: 0,
};

const spec = (overrides: Partial<ElevationSpec> = {}): ElevationSpec => ({
    ...DEFAULT_ELEVATION,
    ...overrides,
});

/** Closed outlines on a layer, as their extents - which is what an opening reads as. */
function outlines(items: DrawItem[], layer: string) {
    return items
        .filter((item) => item.kind === "polyline" && item.layer === layer)
        .map((item) => {
            const bounds = boundsOf([item]);
            return { x0: bounds.min.x, y0: bounds.min.y, x1: bounds.max.x, y1: bounds.max.y };
        })
        .sort((p, q) => p.x0 - q.x0 || q.x1 - p.x1);
}

/** The outer outline of each opening, dropping the frame drawn inside it. */
const openings = (items: DrawItem[], layer: string) =>
    outlines(items, layer).filter((box, i, all) => !all.some((other, j) => j !== i && contains(other, box)));

const contains = (outer: { x0: number; y0: number; x1: number; y1: number }, inner: typeof outer) =>
    outer.x0 < inner.x0 && outer.y0 < inner.y0 && outer.x1 > inner.x1 && outer.y1 > inner.y1;

const linesOn = (items: DrawItem[], layer: string) =>
    items.filter(
        (item): item is Extract<DrawItem, { kind: "line" }> => item.kind === "line" && item.layer === layer,
    );

const horizontals = (items: DrawItem[], layer: string) =>
    linesOn(items, layer)
        .filter((item) => Math.abs(item.a.y - item.b.y) < 1e-9)
        .map((item) => item.a.y)
        .sort((p, q) => p - q);

const verticals = (items: DrawItem[], layer: string) =>
    linesOn(items, layer).filter((item) => Math.abs(item.a.x - item.b.x) < 1e-9);

describe("levelsOf", () => {
    test("the ground storey's floor sits on top of the plinth", () => {
        expect(levelsOf(6000, spec()).ffl).toEqual([600]);
    });

    test("each storey above is a floor-to-floor higher", () => {
        expect(levelsOf(6000, spec({ storeys: 3 })).ffl).toEqual([600, 3600, 6600]);
    });

    test("a flat roof stops at the top of the wall", () => {
        const levels = levelsOf(6000, spec({ roof: "flat" }));
        expect(levels.wallTop).toBe(3600);
        expect(levels.top).toBe(3600);
    });

    test("a parapet stands above the slab", () => {
        expect(levelsOf(6000, spec({ roof: "parapet", parapetMm: 1000 })).top).toBe(4600);
    });

    test("a gable's ridge is measured off the eaves, not the wall face", () => {
        // 45 degrees makes the arithmetic checkable by hand: half of 6000 is 3000, plus a
        // 500 overhang, so the ridge stands 3500 above the eaves and not 3000.
        const levels = levelsOf(6000, spec({ roof: "pitched", roofPitchDeg: 45, eavesOverhangMm: 500 }));
        expect(levels.top - levels.wallTop).toBeCloseTo(3500, 6);
    });
});

describe("openingsAt", () => {
    test("the ground floor keeps the plan's openings as they are", () => {
        expect(openingsAt(facade, 0)).toEqual(facade.openings);
    });

    test("a door becomes a window on the storeys above, in the same place", () => {
        // A doorway on the first floor opens onto nothing. Repeating the plan is the only
        // thing an upper storey can do, so the one liberty taken is glazing it.
        const upper = openingsAt(facade, 1);
        expect(upper.map((o) => o.kind)).toEqual(["window", "window"]);
        expect(upper[0].centerMm).toBe(1500);
        expect(upper[0].widthMm).toBe(1000);
    });

    test("windows are left alone", () => {
        expect(openingsAt(facade, 1)[1]).toEqual(facade.openings[1]);
    });
});

describe("buildElevation", () => {
    test("openings keep the horizontal positions the plan gave them", () => {
        // The whole point of extracting rather than imagining: these numbers come off the
        // canvas and must survive the trip without being rounded, nudged or re-laid-out.
        const items = buildElevation(facade, spec(), ctx);
        expect(openings(items, "DOOR")[0].x0).toBe(1000);
        expect(openings(items, "DOOR")[0].x1).toBe(2000);
        expect(openings(items, "WINDOW")[0].x0).toBe(3400);
        expect(openings(items, "WINDOW")[0].x1).toBe(4600);
    });

    test("a door stands on the floor and a window on its sill, both heading at the lintel", () => {
        const items = buildElevation(facade, spec(), ctx);
        const door = openings(items, "DOOR")[0];
        const window = openings(items, "WINDOW")[0];

        expect(door.y0).toBe(600);
        expect(door.y1).toBe(2700);
        expect(window.y0).toBe(1500);
        expect(window.y1).toBe(2700);
    });

    test("every storey repeats the openings at its own floor level", () => {
        const items = buildElevation(facade, spec({ storeys: 2 }), ctx);
        const heads = openings(items, "WINDOW").map((box) => box.y1);
        // The ground floor's door is a window upstairs, so the upper storey has two.
        expect(heads).toHaveLength(3);
        expect(new Set(heads)).toEqual(new Set([2700, 5700]));
    });

    test("the walls run from the ground, not from the finished floor", () => {
        // A plinth is visible from outside. Starting the ends at floor level draws a
        // house hovering over its own ground line.
        const items = buildElevation(facade, spec(), ctx);
        const ends = verticals(items, "WALL");
        expect(ends).toHaveLength(2);
        for (const end of ends) expect(Math.min(end.a.y, end.b.y)).toBe(0);
    });

    test("the ground line runs past the building on both sides", () => {
        const items = buildElevation(facade, spec(), ctx);
        const ground = items.find((item) => item.layer === "GROUND");
        const bounds = boundsOf([ground!]);
        expect(bounds.min.x).toBeLessThan(0);
        expect(bounds.max.x).toBeGreaterThan(facade.widthMm);
    });

    test("a wide window is divided into panes, a narrow one is not", () => {
        const mullions = (widthMm: number) => {
            const one: Facade = { ...facade, openings: [{ kind: "window", centerMm: 3000, widthMm }] };
            return verticals(buildElevation(one, spec(), ctx), "WINDOW").length;
        };

        expect(mullions(800)).toBe(0);
        expect(mullions(1200)).toBe(1);
        expect(mullions(2700)).toBe(2);
    });

    test("a parapet caps the wall above the slab", () => {
        const items = buildElevation(facade, spec({ roof: "parapet", parapetMm: 1000 }), ctx);
        expect(horizontals(items, "ROOF")).toEqual([4600]);
        expect(horizontals(items, "WALL")).toContain(3600);
    });

    test("a flat roof draws nothing above the slab", () => {
        const items = buildElevation(facade, spec({ roof: "flat" }), ctx);
        expect(items.filter((item) => item.layer === "ROOF")).toHaveLength(0);
        expect(boundsOf(items.filter((i) => i.layer === "WALL")).max.y).toBe(3600);
    });

    test("a gable overhangs the wall and does not double the line along its eaves", () => {
        const items = buildElevation(facade, spec({ roof: "pitched", eavesOverhangMm: 450 }), ctx);
        const roof = boundsOf(items.filter((item) => item.layer === "ROOF"));

        expect(roof.min.x).toBe(-450);
        expect(roof.max.x).toBe(6450);
        // The eaves line is the roof's; the wall must not draw its own on top of it.
        expect(horizontals(items, "WALL")).toEqual([600]);
    });

    test("the drawing is titled with the side it was read from", () => {
        const text = buildElevation(facade, spec(), ctx).find((item) => item.kind === "text");
        expect(text).toBeDefined();
        expect((text as Extract<DrawItem, { kind: "text" }>).text).toBe("SOUTH ELEVATION");
    });

    test("a blank facade still draws a building", () => {
        const blank: Facade = { ...facade, openings: [] };
        const items = buildElevation(blank, spec(), ctx);
        expect(items.filter((item) => item.layer === "WALL").length).toBeGreaterThan(0);
        expect(openings(items, "WINDOW")).toHaveLength(0);
    });
});

describe("coerceElevation", () => {
    test("an empty request draws the ordinary house", () => {
        const result = coerceElevation({}, ctx);
        expect(result.value).toEqual(DEFAULT_ELEVATION);
    });

    test("lengths arrive as text and are parsed", () => {
        expect(coerceElevation({ plinthMm: "750" }, ctx).value.plinthMm).toBe(750);
    });

    test("a lintel below the sill is refused rather than drawn upside down", () => {
        const result = coerceElevation({ sillMm: 1800, lintelMm: 1600 }, ctx);
        expect(result.isOk).toBe(false);
        expect(result.error.code).toBe("lintelBelowSill");
    });

    test("a lintel above the floor above it is refused", () => {
        const result = coerceElevation({ lintelMm: 3200, floorToFloorMm: 3000 }, ctx);
        expect(result.isOk).toBe(false);
        expect(result.error.code).toBe("lintelAboveFloor");
    });

    test("a height outside what a building could be is refused", () => {
        expect(coerceElevation({ storeys: 40 }, ctx).isOk).toBe(false);
    });
});

describe("summarizeElevation", () => {
    test("reads back what is about to be drawn", () => {
        const summary = summarizeElevation(facade, spec(), ctx);
        expect(summary).toContain("south elevation");
        expect(summary).toContain("6000");
        expect(summary).toContain("2 openings per floor");
    });
});

describe("a plan, extracted and elevated", () => {
    const planSpec: FloorPlanSpec = { ...DEFAULT_SPEC, entrySide: "front" };
    const ir = generateFloorPlan(planSpec).value;
    const plan = buildDrawing(ir, ctx);
    const window = {
        min: { x: ir.outer.x0 - 1000, y: ir.outer.y0 - 1000 },
        max: { x: ir.outer.x1 + 1000, y: ir.outer.y1 + 1000 },
    };

    test("every opening in the elevation stands directly under the one in the plan", () => {
        // The end-to-end claim the whole feature rests on. The elevation is drawn in its
        // own space starting at zero, so adding the facade's world origin back is what a
        // draftsman does when they project the view down the sheet - and if the two ever
        // disagree, the drawing is discredited at a glance.
        const read = extractFacade(plan, { side: "south", window }).value;
        const items = buildElevation(read, spec(), ctx);

        const wall = ir.walls.find((w) => w.id === "ext.south")!;
        const expected = wall.openings
            .filter((o) => o.kind !== "junction")
            .map((o) => wallPoint(wall, o.centerMm).x)
            .sort((p, q) => p - q);

        const drawn = [...openings(items, "DOOR"), ...openings(items, "WINDOW")]
            .map((box) => read.origin.x + (box.x0 + box.x1) / 2)
            .sort((p, q) => p - q);

        expect(drawn).toHaveLength(expected.length);
        for (const [i, x] of drawn.entries()) expect(x).toBeCloseTo(expected[i], 6);
    });

    test("the elevation is exactly as wide as the plan it was read from", () => {
        const read = extractFacade(plan, { side: "south", window }).value;
        const items = buildElevation(read, spec(), ctx);
        const walls = boundsOf(items.filter((item) => item.layer === "WALL"));

        expect(walls.max.x - walls.min.x).toBeCloseTo(ir.outer.x1 - ir.outer.x0, 6);
    });
});

describe("placing the drawing", () => {
    test("translating moves every kind of item and changes no size", () => {
        const items: DrawItem[] = [
            { kind: "line", layer: "W", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
            { kind: "arc", layer: "W", center: { x: 0, y: 0 }, start: { x: 5, y: 0 }, sweepDeg: 90 },
            { kind: "circle", layer: "W", center: { x: 0, y: 0 }, radiusMm: 3 },
            {
                kind: "polyline",
                layer: "W",
                points: [
                    { x: 0, y: 0 },
                    { x: 4, y: 4 },
                ],
                closed: false,
            },
            { kind: "text", layer: "T", at: { x: 0, y: 0 }, text: "X", heightMm: 2, rotationDeg: 0 },
        ];
        const before = boundsOf(items);
        const moved = translateItems(items, { x: 100, y: -50 });
        const after = boundsOf(moved);

        expect(after.min.x - before.min.x).toBeCloseTo(100, 6);
        expect(after.min.y - before.min.y).toBeCloseTo(-50, 6);
        expect(after.max.x - after.min.x).toBeCloseTo(before.max.x - before.min.x, 6);
        expect(after.max.y - after.min.y).toBeCloseTo(before.max.y - before.min.y, 6);
    });

    test("the elevation lands clear below the picked plan, left edges aligned", () => {
        const items = buildElevation(facade, spec(), ctx);
        const window = { min: { x: 5000, y: 20000 }, max: { x: 11000, y: 32000 } };
        const placed = translateItems(items, placementBelow(items, window, 2000));
        const bounds = boundsOf(placed);

        expect(bounds.min.x).toBeCloseTo(window.min.x, 6);
        expect(bounds.max.y).toBeCloseTo(window.min.y - 2000, 6);
    });

    test("placing does not depend on where the elevation was drawn", () => {
        // The elevation is built at the origin, but its label hangs below zero and a
        // gable rises above the wall - so the offset has to come off the drawing's own
        // extents rather than off an assumed corner at 0,0.
        const items = buildElevation(facade, spec({ roof: "pitched" }), ctx);
        const window = { min: { x: 0, y: 0 }, max: { x: 6000, y: 12000 } };
        const bounds = boundsOf(translateItems(items, placementBelow(items, window, 1000)));

        expect(bounds.max.y).toBeCloseTo(-1000, 6);
        expect(bounds.min.x).toBeCloseTo(0, 6);
    });
});
