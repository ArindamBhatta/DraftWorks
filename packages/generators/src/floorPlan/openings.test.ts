import { describe, expect, test } from "@rstest/core";
import { DEFAULT_SPEC, WINDOW_CORNER_CLEARANCE } from "./defaults";
import { generateFloorPlan } from "./generator";
import { spanOf } from "./intervals";
import type { FloorPlanIR, FloorPlanSpec, Opening, WallSegment } from "./plan";
import { wallAxes } from "./plan";

function planOf(overrides: Partial<FloorPlanSpec> = {}): FloorPlanIR {
    const result = generateFloorPlan({ ...DEFAULT_SPEC, ...overrides } as FloorPlanSpec);
    expect(result.isOk, JSON.stringify(result.error)).toBe(true);
    return result.value;
}

const openingsOf = (ir: FloorPlanIR, kind: Opening["kind"]) =>
    ir.walls.flatMap((w) => w.openings.filter((o) => o.kind === kind).map((o) => ({ wall: w, o })));

describe("every room is reachable and lit", () => {
    for (const bedrooms of [1, 2, 3]) {
        test(`a ${bedrooms}BHK gives every room one door and one window`, () => {
            const ir = planOf({ bedrooms, plotWidthMm: 9144 + Math.max(0, bedrooms - 2) * 3000 });
            expect(openingsOf(ir, "door")).toHaveLength(ir.rooms.length);
            expect(openingsOf(ir, "window")).toHaveLength(ir.rooms.length);
        });
    }

    test("the entrance is on the front external wall", () => {
        const ir = planOf();
        const entries = openingsOf(ir, "door").filter((d) => d.o.widthMm === DEFAULT_SPEC.entryDoorWidthMm);
        expect(entries).toHaveLength(1);
        expect(entries[0].wall.id).toBe("ext.south");
        expect(entries[0].wall.exterior).toBe(true);
    });

    test("bathroom doors are the narrow ones and swing into the bathroom", () => {
        const ir = planOf();
        const bathDoors = openingsOf(ir, "door").filter((d) => d.o.widthMm === DEFAULT_SPEC.bathDoorWidthMm);
        expect(bathDoors).toHaveLength(2);
        // The common toilet sits on the -x side of the front partition's left face, the
        // attached one on the +y side of the master partition; each door swings the way
        // that carries it into the bathroom.
        for (const { wall, o } of bathDoors) {
            const expected = wall.id === "part.front" ? -1 : 1;
            expect(o.swing, `${wall.id}`).toBe(expected);
        }
    });
});

describe("openings sit where they can actually be built", () => {
    const ir = planOf();

    test("nothing on a wall overlaps anything else on that wall", () => {
        for (const wall of ir.walls) {
            const spans = wall.openings.map(spanOf).sort((a, b) => a.lo - b.lo);
            for (let i = 1; i < spans.length; i++) {
                // Junctions on opposite faces may coincide; two things a person passes
                // through never may.
                const previous = wall.openings.find((o) => spanOf(o).lo === spans[i - 1].lo)!;
                const current = wall.openings.find((o) => spanOf(o).lo === spans[i].lo)!;
                const bothJunctions = previous.kind === "junction" && current.kind === "junction";
                if (bothJunctions && previous.face !== current.face) continue;
                expect(spans[i].lo, `${wall.id}`).toBeGreaterThanOrEqual(spans[i - 1].hi - 1e-6);
            }
        }
    });

    test("every opening lies within the wall that carries it", () => {
        for (const wall of ir.walls) {
            const { length } = wallAxes(wall);
            for (const opening of wall.openings) {
                const span = spanOf(opening);
                expect(span.lo, `${wall.id} ${opening.kind}`).toBeGreaterThanOrEqual(-1e-6);
                expect(span.hi, `${wall.id} ${opening.kind}`).toBeLessThanOrEqual(length + 1e-6);
            }
        }
    });

    test("no window is jammed into a corner", () => {
        for (const { wall, o } of openingsOf(ir, "window")) {
            const { length } = wallAxes(wall);
            const span = spanOf(o);
            // Measured against the wall as a whole; the placement rule keeps the same
            // clearance from the room's own frontage, which is the tighter bound.
            expect(span.lo, `${wall.id}`).toBeGreaterThanOrEqual(WINDOW_CORNER_CLEARANCE - 1e-6);
            expect(span.hi, `${wall.id}`).toBeLessThanOrEqual(length - WINDOW_CORNER_CLEARANCE + 1e-6);
        }
    });

    test("every door records a hinge and a swing", () => {
        for (const { o } of openingsOf(ir, "door")) {
            expect(o.hinge === "start" || o.hinge === "end").toBe(true);
            expect(o.swing === 1 || o.swing === -1).toBe(true);
        }
    });
});

describe("junctions mark where partitions land", () => {
    const ir = planOf();
    const junctions = (wall: WallSegment) => wall.openings.filter((o) => o.kind === "junction");

    test("each junction eats one named face and is one partition thick", () => {
        for (const wall of ir.walls) {
            for (const junction of junctions(wall)) {
                expect(junction.face === "left" || junction.face === "right").toBe(true);
                expect(junction.widthMm).toBe(DEFAULT_SPEC.internalWallMm);
            }
        }
    });

    test("both ends of every partition are registered against the wall they meet", () => {
        // 4 partitions in a 2BHK (front, kitchen, band, master) plus the rear split,
        // each with two ends.
        const total = ir.walls.reduce((sum, w) => sum + junctions(w).length, 0);
        expect(total).toBe(2 * ir.walls.filter((w) => !w.exterior).length);
    });
});
