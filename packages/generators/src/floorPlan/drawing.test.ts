import { describe, expect, test } from "@rstest/core";
import type { GeneratorContext } from "../registry";
import { arcEnd, type DrawItem } from "../types";
import { DEFAULT_SPEC } from "./defaults";
import { buildDrawing, splitInterval } from "./drawing";
import { generateFloorPlan } from "./generator";
import type { FloorPlanIR, FloorPlanSpec, Opening, WallSegment } from "./plan";

const ctx: GeneratorContext = { format: (mm) => String(Math.round(mm)), parseLength: Number };

describe("splitInterval", () => {
    test("an uncut domain survives whole", () => {
        expect(splitInterval({ lo: 0, hi: 10 }, [])).toEqual([{ lo: 0, hi: 10 }]);
    });

    test("a cut in the middle leaves two pieces", () => {
        expect(splitInterval({ lo: 0, hi: 10 }, [{ lo: 4, hi: 6 }])).toEqual([
            { lo: 0, hi: 4 },
            { lo: 6, hi: 10 },
        ]);
    });

    test("a cut flush with an end leaves one piece, not a zero-length sliver", () => {
        expect(splitInterval({ lo: 0, hi: 10 }, [{ lo: 0, hi: 3 }])).toEqual([{ lo: 3, hi: 10 }]);
    });

    test("overlapping cuts merge", () => {
        expect(
            splitInterval({ lo: 0, hi: 10 }, [
                { lo: 2, hi: 5 },
                { lo: 4, hi: 8 },
            ]),
        ).toEqual([
            { lo: 0, hi: 2 },
            { lo: 8, hi: 10 },
        ]);
    });

    test("a cut covering everything leaves nothing", () => {
        expect(splitInterval({ lo: 0, hi: 10 }, [{ lo: -5, hi: 15 }])).toEqual([]);
    });

    test("cuts outside the domain are ignored", () => {
        expect(splitInterval({ lo: 0, hi: 10 }, [{ lo: 20, hi: 30 }])).toEqual([{ lo: 0, hi: 10 }]);
    });
});

function bareWall(openings: Opening[]): WallSegment {
    return {
        id: "test",
        start: { x: 0, y: 0 },
        end: { x: 4000, y: 0 },
        thicknessMm: 115,
        exterior: false,
        openings,
        trim: { start: { left: 0, right: 0 }, end: { left: 0, right: 0 } },
    };
}

function drawWallOnly(openings: Opening[]): DrawItem[] {
    const ir: FloorPlanIR = {
        spec: DEFAULT_SPEC as unknown as FloorPlanSpec,
        outer: { x0: 0, y0: 0, x1: 4000, y1: 4000 },
        interior: { x0: 0, y0: 0, x1: 4000, y1: 4000 },
        walls: [bareWall(openings)],
        rooms: [],
    };
    return buildDrawing(ir, ctx);
}

describe("a wall becomes two face lines with its openings cut out", () => {
    test("a door breaks both faces and closes the reveal with two jambs", () => {
        const items = drawWallOnly([
            { kind: "door", centerMm: 2000, widthMm: 900, hinge: "start", swing: 1 },
        ]);
        const wallLines = items.filter((i) => i.layer === "WALL");
        // Two pieces per face, plus a jamb at each end of the opening.
        expect(wallLines).toHaveLength(6);
        expect(items.filter((i) => i.layer === "DOOR")).toHaveLength(2); // leaf + swing arc
    });

    test("a window leaves both faces running and adds its own three lines", () => {
        const items = drawWallOnly([{ kind: "window", centerMm: 2000, widthMm: 1200 }]);
        expect(items.filter((i) => i.layer === "WALL")).toHaveLength(2);
        // Two jambs and the glass line down the middle.
        expect(items.filter((i) => i.layer === "WINDOW")).toHaveLength(3);
    });

    test("a junction breaks only the face its partition touches", () => {
        const items = drawWallOnly([{ kind: "junction", centerMm: 2000, widthMm: 115, face: "left" }]);
        // The eaten face splits in two; the far face runs straight through.
        expect(items.filter((i) => i.layer === "WALL")).toHaveLength(3);
    });
});

describe("door swings", () => {
    for (const hinge of ["start", "end"] as const) {
        for (const swing of [1, -1] as const) {
            test(`a door hinged at the ${hinge} swinging ${swing > 0 ? "left" : "right"} sweeps a quarter turn`, () => {
                const items = drawWallOnly([{ kind: "door", centerMm: 2000, widthMm: 900, hinge, swing }]);
                const arc = items.find((i) => i.kind === "arc");
                expect(arc?.kind).toBe("arc");
                if (arc?.kind !== "arc") return;

                expect(Math.abs(arc.sweepDeg)).toBeCloseTo(90);

                // The arc must land on the far jamb - that is what makes it read as the
                // door's swing rather than as a stray fillet.
                const farJambS = hinge === "start" ? 2450 : 1550;
                const end = arcEnd(arc);
                expect(end.x).toBeCloseTo(farJambS);
                expect(end.y).toBeCloseTo(0);
            });
        }
    }
});

describe("room labels", () => {
    test("a room is captioned with its name over its size", () => {
        const ir: FloorPlanIR = {
            spec: { ...DEFAULT_SPEC, textHeightMm: 100 } as unknown as FloorPlanSpec,
            outer: { x0: 0, y0: 0, x1: 4000, y1: 4000 },
            interior: { x0: 0, y0: 0, x1: 4000, y1: 4000 },
            walls: [],
            rooms: [
                {
                    id: "master",
                    kind: "master",
                    name: "MASTER BEDROOM",
                    rect: { x0: 0, y0: 0, x1: 3600, y1: 3300 },
                },
            ],
        };
        const texts = buildDrawing(ir, ctx).filter((i) => i.kind === "text");
        expect(texts).toHaveLength(2);
        expect(texts.map((t) => (t.kind === "text" ? t.text : ""))).toEqual([
            "MASTER BEDROOM",
            "3600 X 3300",
        ]);
        // The name sits above the size, and both take the requested cap height.
        const [name, size] = texts.filter((t) => t.kind === "text");
        if (name.kind !== "text" || size.kind !== "text") return;
        expect(name.at.y).toBeGreaterThan(size.at.y);
        expect(name.heightMm).toBe(100);
    });

    test("the size reads in the drawing's own units", () => {
        const feet: GeneratorContext = {
            format: (mm) => `${(mm / 304.8).toFixed(1)}'`,
            parseLength: Number,
        };
        const ir: FloorPlanIR = {
            spec: DEFAULT_SPEC as unknown as FloorPlanSpec,
            outer: { x0: 0, y0: 0, x1: 4000, y1: 4000 },
            interior: { x0: 0, y0: 0, x1: 4000, y1: 4000 },
            walls: [],
            rooms: [
                { id: "k", kind: "kitchen", name: "KITCHEN", rect: { x0: 0, y0: 0, x1: 3048, y1: 2438.4 } },
            ],
        };
        const texts = buildDrawing(ir, feet).filter((i) => i.kind === "text");
        expect(texts[1].kind === "text" && texts[1].text).toBe("10.0' X 8.0'");
    });
});

describe("the whole plan draws cleanly", () => {
    const ir = generateFloorPlan(DEFAULT_SPEC as unknown as FloorPlanSpec).value;
    const items = buildDrawing(ir, ctx);

    test("no degenerate line survives - the kernel rejects zero-length edges", () => {
        for (const item of items) {
            if (item.kind !== "line") continue;
            expect(Math.hypot(item.b.x - item.a.x, item.b.y - item.a.y)).toBeGreaterThan(1e-6);
        }
    });

    test("every layer the generator declares is actually used", () => {
        const used = new Set(items.map((i) => i.layer));
        expect([...used].sort()).toEqual(["DOOR", "TEXT", "WALL", "WINDOW"]);
    });

    test("nothing strays outside the building, bar the door leaves", () => {
        const slack = DEFAULT_SPEC.entryDoorWidthMm;
        for (const item of items) {
            const points = item.kind === "line" ? [item.a, item.b] : item.kind === "arc" ? [item.center] : [];
            for (const p of points) {
                expect(p.x).toBeGreaterThanOrEqual(ir.outer.x0 - slack);
                expect(p.x).toBeLessThanOrEqual(ir.outer.x1 + slack);
                expect(p.y).toBeGreaterThanOrEqual(ir.outer.y0 - slack);
                expect(p.y).toBeLessThanOrEqual(ir.outer.y1 + slack);
            }
        }
    });

    test("the same spec always draws the same plan", () => {
        const again = buildDrawing(generateFloorPlan(DEFAULT_SPEC as unknown as FloorPlanSpec).value, ctx);
        expect(again).toEqual(items);
    });
});
