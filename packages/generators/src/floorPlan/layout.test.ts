import { describe, expect, test } from "@rstest/core";
import { DEFAULT_SPEC, ROOM_MIN } from "./defaults";
import { checkFeasible, layout, roomsOf, type SliceGrid } from "./layout";
import { type FloorPlanSpec, type Rect, type RoomCell, rectDepth, rectWidth } from "./plan";
import { buildWalls } from "./walls";

export function specOf(overrides: Partial<FloorPlanSpec> = {}): FloorPlanSpec {
    return { ...DEFAULT_SPEC, ...overrides } as FloorPlanSpec;
}

function gridOf(spec: FloorPlanSpec): SliceGrid {
    const result = layout(spec);
    expect(result.isOk, JSON.stringify(result.unchecked() ?? result.error)).toBe(true);
    return result.value;
}

const area = (r: Rect) => rectWidth(r) * rectDepth(r);

function overlaps(a: Rect, b: Rect): boolean {
    return a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.y0 < b.y1 - 1e-6 && b.y0 < a.y1 - 1e-6;
}

describe("the plan partitions its footprint exactly", () => {
    for (const bedrooms of [1, 2, 3, 4]) {
        test(`${bedrooms}BHK leaves no gap and no overlap`, () => {
            // Widen the plot with the bedroom count - a 4BHK does not fit on a 30x40.
            const spec = specOf({
                bedrooms,
                plotWidthMm: 9144 + Math.max(0, bedrooms - 2) * 3000,
                plotDepthMm: 12192,
            });
            const grid = gridOf(spec);
            const rooms = roomsOf(grid);
            const walls = buildWalls(grid);

            for (let i = 0; i < rooms.length; i++) {
                for (let j = i + 1; j < rooms.length; j++) {
                    expect(
                        overlaps(rooms[i].rect, rooms[j].rect),
                        `${rooms[i].id} overlaps ${rooms[j].id}`,
                    ).toBe(false);
                }
            }

            // Rooms plus the internal partitions they are separated by must account for
            // every square millimetre inside the external wall. Interior partitions run
            // face-to-face and never overlap each other, so their area is just l x t.
            const roomArea = rooms.reduce((sum, r) => sum + area(r.rect), 0);
            const partitionArea = walls
                .filter((w) => !w.exterior)
                .reduce(
                    (sum, w) => sum + Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) * w.thicknessMm,
                    0,
                );

            expect(roomArea + partitionArea).toBeCloseTo(area(grid.interior), 4);
        });
    }
});

describe("rooms are habitable", () => {
    const spec = specOf();
    const grid = gridOf(spec);
    const rooms = roomsOf(grid);

    const minFor = (room: RoomCell) => {
        if (room.kind === "living") return ROOM_MIN.living;
        if (room.kind === "kitchen") return ROOM_MIN.kitchen;
        if (room.kind === "master") return ROOM_MIN.master;
        if (room.kind === "bedroom") return ROOM_MIN.bedroom;
        return ROOM_MIN.bath;
    };

    test("every room clears its minimum size", () => {
        for (const room of rooms) {
            const min = minFor(room);
            expect(rectWidth(room.rect), `${room.id} width`).toBeGreaterThanOrEqual(min.w - 1e-6);
            expect(rectDepth(room.rect), `${room.id} depth`).toBeGreaterThanOrEqual(min.d - 1e-6);
        }
    });

    test("every room reaches an external wall, so every room can take a window", () => {
        const i = grid.interior;
        for (const room of rooms) {
            const touches =
                Math.abs(room.rect.x0 - i.x0) < 1e-6 ||
                Math.abs(room.rect.x1 - i.x1) < 1e-6 ||
                Math.abs(room.rect.y0 - i.y0) < 1e-6 ||
                Math.abs(room.rect.y1 - i.y1) < 1e-6;
            expect(touches, `${room.id} is landlocked`).toBe(true);
        }
    });

    test("a 2BHK draws living, kitchen, two baths, the master and one more bedroom", () => {
        expect(rooms.map((r) => r.id).sort()).toEqual([
            "bath1",
            "bath2",
            "bedroom2",
            "kitchen",
            "living",
            "master",
        ]);
    });

    test("the master bedroom keeps enough frontage on the living room for its door", () => {
        const living = rooms.find((r) => r.id === "living")!.rect;
        const master = rooms.find((r) => r.id === "master")!.rect;
        const frontage = Math.min(living.x1, master.x1) - Math.max(living.x0, master.x0);
        expect(frontage).toBeGreaterThanOrEqual(spec.doorWidthMm + 2 * 150);
    });
});

describe("plots that cannot hold the plan are refused, not shrunk", () => {
    test("a 5 x 9 m plot is reported as too small, with the size it would need", () => {
        const result = layout(specOf({ plotWidthMm: 5000, plotDepthMm: 9000 }));
        expect(result.isOk).toBe(false);
        expect(result.error.code).toBe("tooSmall");
        expect(result.error.detail!["neededWidthMm"]).toBeGreaterThan(
            result.error.detail!["availableWidthMm"] as number,
        );
    });

    test("setbacks that swallow the plot are named as such", () => {
        const result = layout(specOf({ setbackLeftMm: 5000, setbackRightMm: 5000 }));
        expect(result.isOk).toBe(false);
        expect(result.error.code).toBe("setbacksExceedPlot");
    });

    test("a 4BHK is refused on a 30x40 rather than drawn at 2 m per bedroom", () => {
        const result = layout(specOf({ bedrooms: 4 }));
        expect(result.isOk).toBe(false);
        expect(result.error.code).toBe("tooSmall");
    });

    test("checkFeasible agrees with layout across a sweep of plot sizes", () => {
        for (let w = 5000; w <= 16000; w += 500) {
            for (let d = 7000; d <= 18000; d += 500) {
                const spec = specOf({ plotWidthMm: w, plotDepthMm: d });
                expect(checkFeasible(spec).ok, `${w} x ${d}`).toBe(layout(spec).isOk);
            }
        }
    });
});

test("a 30x40 ft plot - the commonest case - produces a workable 2BHK", () => {
    const grid = gridOf(specOf());
    const rooms = roomsOf(grid);
    const living = rooms.find((r) => r.id === "living")!;
    // Sanity on scale rather than exact numbers: the living room should read as a room,
    // not as a corridor or as the whole house.
    expect(area(living.rect) / 1e6).toBeGreaterThan(12);
    expect(area(living.rect) / 1e6).toBeLessThan(40);
});
