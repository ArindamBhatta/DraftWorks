import { describe, expect, test } from "@rstest/core";
import { DEFAULT_SPEC } from "./defaults";
import { generateFloorPlan } from "./generator";
import {
    ENTRY_SIDES,
    type EntrySide,
    type FloorPlanIR,
    type FloorPlanSpec,
    rectDepth,
    rectWidth,
    wallAxes,
} from "./plan";

const planFor = (entrySide: EntrySide): FloorPlanIR => {
    const result = generateFloorPlan({ ...DEFAULT_SPEC, entrySide } as FloorPlanSpec);
    expect(result.isOk, JSON.stringify(result.error)).toBe(true);
    return result.value;
};

const totalWallLength = (ir: FloorPlanIR) => ir.walls.reduce((sum, w) => sum + wallAxes(w).length, 0);
const areas = (ir: FloorPlanIR) =>
    ir.rooms.map((r) => Math.round(rectWidth(r.rect) * rectDepth(r.rect))).sort((a, b) => a - b);

describe("re-orienting the plan is a rigid motion", () => {
    const front = planFor("front");

    for (const side of ENTRY_SIDES) {
        test(`entry from the ${side} preserves every room's area and every wall's length`, () => {
            const rotated = planFor(side);
            expect(areas(rotated)).toEqual(areas(front));
            expect(totalWallLength(rotated)).toBeCloseTo(totalWallLength(front), 6);
        });

        test(`entry from the ${side} leaves every opening where it was on its wall`, () => {
            const rotated = planFor(side);
            for (let i = 0; i < front.walls.length; i++) {
                expect(rotated.walls[i].openings.map((o) => o.centerMm)).toEqual(
                    front.walls[i].openings.map((o) => o.centerMm),
                );
                expect(rotated.walls[i].openings.map((o) => o.swing)).toEqual(
                    front.walls[i].openings.map((o) => o.swing),
                );
                expect(rotated.walls[i].openings.map((o) => o.face)).toEqual(
                    front.walls[i].openings.map((o) => o.face),
                );
            }
        });
    }

    test("asking for the front changes nothing at all", () => {
        expect(planFor("front")).toEqual(front);
    });
});

describe("the entrance lands on the plot edge that was asked for", () => {
    const entryWallOf = (ir: FloorPlanIR) => {
        for (const wall of ir.walls) {
            if (!wall.exterior) continue;
            if (wall.openings.some((o) => o.kind === "door" && o.widthMm === DEFAULT_SPEC.entryDoorWidthMm))
                return wall;
        }
        throw new Error("no entry door");
    };

    const bounds = (ir: FloorPlanIR) => ir.outer;

    for (const [side, check] of [
        ["front", (w: number[], b: { y0: number }) => expect(w[1]).toBeCloseTo(b.y0, 0)],
        ["rear", (w: number[], b: { y1: number }) => expect(w[1]).toBeCloseTo(b.y1, 0)],
        ["left", (w: number[], b: { x0: number }) => expect(w[0]).toBeCloseTo(b.x0, 0)],
        ["right", (w: number[], b: { x1: number }) => expect(w[0]).toBeCloseTo(b.x1, 0)],
    ] as const) {
        test(`entry from the ${side}`, () => {
            const ir = planFor(side);
            const wall = entryWallOf(ir);
            const half = wall.thicknessMm / 2;
            const b = bounds(ir);
            // The centreline sits half a wall inside the setback line it runs along.
            const point = [wall.start.x, wall.start.y];
            const nudged =
                side === "front"
                    ? [point[0], point[1] - half]
                    : side === "rear"
                      ? [point[0], point[1] + half]
                      : side === "left"
                        ? [point[0] - half, point[1]]
                        : [point[0] + half, point[1]];
            (check as (w: number[], b: unknown) => void)(nudged, b);
        });
    }
});
