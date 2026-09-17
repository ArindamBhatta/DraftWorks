import { describe, expect, test } from "@rstest/core";
import { DEFAULT_SPEC } from "../floorPlan/defaults";
import { buildDrawing } from "../floorPlan/drawing";
import { generateFloorPlan } from "../floorPlan/generator";
import { type FloorPlanSpec, wallPoint } from "../floorPlan/plan";
import type { GeneratorContext } from "../registry";
import type { Bounds, DrawItem } from "../types";
import {
    bandsOf,
    clipSegment,
    extractFacade,
    type FacadeSide,
    FRAMES,
    findWall,
    gapsOf,
    readGeometry,
    resolveTolerances,
} from "./facade";

const ctx: GeneratorContext = { format: (mm) => String(Math.round(mm)), parseLength: Number };

const line = (ax: number, ay: number, bx: number, by: number, layer = "WALL"): DrawItem => ({
    kind: "line",
    layer,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
});

const box = (x0: number, y0: number, x1: number, y1: number): Bounds => ({
    min: { x: x0, y: y0 },
    max: { x: x1, y: y1 },
});

/**
 * A single 6 m wall, 230 thick, drawn the way a draftsman draws one: faces at y=0 and
 * y=230, a 1000 door at 1500 that breaks both of them, and a 1200 window at 4000 that
 * breaks neither but is jambed and glazed. Read from the south, so the y=0 face is the
 * one facing the viewer.
 */
function wallFixture(): DrawItem[] {
    return [
        // Outer face, broken by the door only.
        line(0, 0, 1000, 0),
        line(2000, 0, 6000, 0),
        // Inner face, likewise.
        line(0, 230, 1000, 230),
        line(2000, 230, 6000, 230),
        // Door jambs and swing, hinged on the left.
        line(1000, 0, 1000, 230),
        line(2000, 0, 2000, 230),
        { kind: "arc", layer: "DOOR", center: { x: 1000, y: 115 }, start: { x: 2000, y: 115 }, sweepDeg: 90 },
        // Window jambs and its glass line.
        line(3400, 0, 3400, 230, "WINDOW"),
        line(4600, 0, 4600, 230, "WINDOW"),
        line(3400, 115, 4600, 115, "WINDOW"),
    ];
}

const WINDOW = box(-500, -500, 6500, 1000);

describe("clipSegment", () => {
    const window = box(0, 0, 100, 100);

    test("a segment wholly inside survives unchanged", () => {
        const clipped = clipSegment({ a: { x: 10, y: 10 }, b: { x: 90, y: 90 }, layer: "W" }, window);
        expect(clipped).toEqual({ a: { x: 10, y: 10 }, b: { x: 90, y: 90 }, layer: "W" });
    });

    test("a segment wholly outside is dropped", () => {
        expect(
            clipSegment({ a: { x: 200, y: 10 }, b: { x: 300, y: 90 }, layer: "W" }, window),
        ).toBeUndefined();
    });

    test("a segment running out of the box is cut at the edge, not discarded", () => {
        const clipped = clipSegment({ a: { x: 50, y: 50 }, b: { x: 250, y: 50 }, layer: "W" }, window);
        expect(clipped?.b).toEqual({ x: 100, y: 50 });
    });

    test("a segment parallel to an edge and outside it is dropped", () => {
        expect(
            clipSegment({ a: { x: 0, y: 150 }, b: { x: 100, y: 150 }, layer: "W" }, window),
        ).toBeUndefined();
    });

    test("a segment lying along an edge survives", () => {
        const clipped = clipSegment({ a: { x: 10, y: 0 }, b: { x: 90, y: 0 }, layer: "W" }, window);
        expect(clipped).toBeDefined();
    });
});

describe("gapsOf", () => {
    test("an unbroken face has no gaps", () => {
        expect(gapsOf([{ lo: 0, hi: 10 }], { lo: 0, hi: 10 })).toEqual([]);
    });

    test("a break in the middle is one gap", () => {
        expect(
            gapsOf(
                [
                    { lo: 0, hi: 4 },
                    { lo: 6, hi: 10 },
                ],
                { lo: 0, hi: 10 },
            ),
        ).toEqual([{ lo: 4, hi: 6 }]);
    });

    test("two breaks are two gaps", () => {
        expect(
            gapsOf(
                [
                    { lo: 0, hi: 2 },
                    { lo: 3, hi: 5 },
                    { lo: 7, hi: 10 },
                ],
                { lo: 0, hi: 10 },
            ),
        ).toEqual([
            { lo: 2, hi: 3 },
            { lo: 5, hi: 7 },
        ]);
    });
});

describe("bandsOf", () => {
    const frame = FRAMES.south;
    const tol = resolveTolerances({ side: "south", window: WINDOW });

    test("the two faces of a wall come back as two bands, nearest the viewer first", () => {
        const { segments } = readGeometry(wallFixture(), WINDOW);
        const bands = bandsOf(segments, frame, tol.bandTolerance, tol.angleTolerance);
        const offsets = bands.map((b) => Math.round(b.offset));
        expect(offsets).toEqual([0, -115, -230]);
    });

    test("coverage counts what is drawn, and the span counts end to end across the door", () => {
        const { segments } = readGeometry(wallFixture(), WINDOW);
        const outer = bandsOf(segments, frame, tol.bandTolerance, tol.angleTolerance)[0];
        expect(outer.coverage).toBe(5000);
        expect(outer.span).toEqual({ lo: 0, hi: 6000 });
    });

    test("lines across the facade are not faces of it", () => {
        const { segments } = readGeometry([line(1000, 0, 1000, 230)], WINDOW);
        expect(bandsOf(segments, frame, tol.bandTolerance, tol.angleTolerance)).toEqual([]);
    });
});

describe("findWall", () => {
    const frame = FRAMES.south;
    const tol = resolveTolerances({ side: "south", window: WINDOW });
    const wallOf = (items: DrawItem[]) => {
        const { segments } = readGeometry(items, WINDOW);
        return findWall(bandsOf(segments, frame, tol.bandTolerance, tol.angleTolerance), tol);
    };

    test("the faces of the wall are found, and the glass line is not one of them", () => {
        const wall = wallOf(wallFixture());
        expect(Math.round(wall!.outer.offset)).toBe(0);
        expect(Math.round(wall!.inner.offset)).toBe(-230);
    });

    test("a dimension line outside the building is not read as the outer face", () => {
        // Long, parallel, and further out than anything else - the exact shape of the
        // mistake the pair rule exists to prevent.
        const wall = wallOf([...wallFixture(), line(0, -800, 6000, -800, "DIM")]);
        expect(Math.round(wall!.outer.offset)).toBe(0);
    });

    test("two parallel walls at opposite ends of the plan are not one wall", () => {
        const wall = wallOf([line(0, 0, 3000, 0), line(5000, 230, 8000, 230)]);
        expect(wall).toBeUndefined();
    });

    test("a lone face with no partner is not a wall", () => {
        expect(wallOf([line(0, 0, 6000, 0)])).toBeUndefined();
    });

    test("faces further apart than a wall could be are not a wall", () => {
        expect(wallOf([line(0, 0, 6000, 0), line(0, 2000, 6000, 2000)])).toBeUndefined();
    });
});

describe("extractFacade", () => {
    test("reads the wall's width and thickness", () => {
        const facade = extractFacade(wallFixture(), { side: "south", window: WINDOW });
        expect(facade.value.widthMm).toBe(6000);
        expect(facade.value.wallThicknessMm).toBe(230);
    });

    test("finds the door by the break in the face and the window by its glass", () => {
        const facade = extractFacade(wallFixture(), { side: "south", window: WINDOW });
        expect(facade.value.openings).toEqual([
            { kind: "door", centerMm: 1500, widthMm: 1000, hinge: "left" },
            { kind: "window", centerMm: 4000, widthMm: 1200 },
        ]);
        expect(facade.value.unpairedJambs).toBe(0);
    });

    test("a jambed pair with no glass between them is not a window", () => {
        // The two jambs of two different openings, with solid wall in between. Pairing
        // them would invent a window across the middle of the facade.
        const items = wallFixture().filter(
            (item) => !(item.kind === "line" && item.a.y === 115 && item.b.y === 115),
        );
        const facade = extractFacade(items, { side: "south", window: WINDOW });
        expect(facade.value.openings.map((o) => o.kind)).toEqual(["door"]);
        expect(facade.value.unpairedJambs).toBe(2);
    });

    test("a door drawn without a swing is still a door, just not handed", () => {
        const items = wallFixture().filter((item) => item.kind !== "arc");
        const facade = extractFacade(items, { side: "south", window: WINDOW });
        const door = facade.value.openings.find((o) => o.kind === "door");
        expect(door?.hinge).toBeUndefined();
        expect(door?.widthMm).toBe(1000);
    });

    test("an arc of the wrong size nearby does not hand the door", () => {
        const items = [
            ...wallFixture().filter((item) => item.kind !== "arc"),
            // A basin, drawn against the wall right by the doorway.
            {
                kind: "arc",
                layer: "0",
                center: { x: 1000, y: 400 },
                start: { x: 1250, y: 400 },
                sweepDeg: 180,
            },
        ] as DrawItem[];
        const facade = extractFacade(items, { side: "south", window: WINDOW });
        expect(facade.value.openings.find((o) => o.kind === "door")?.hinge).toBeUndefined();
    });

    test("the origin is the left end of the outer face, in world coordinates", () => {
        const facade = extractFacade(wallFixture(), { side: "south", window: WINDOW });
        expect(facade.value.origin.x).toBeCloseTo(0, 6);
        expect(facade.value.origin.y).toBeCloseTo(0, 6);
    });

    test("the window clips the facade rather than filtering it", () => {
        // Half the wall picked: the facade is half as wide and the window is outside it.
        const facade = extractFacade(wallFixture(), { side: "south", window: box(-500, -500, 3000, 1000) });
        expect(facade.value.widthMm).toBe(3000);
        expect(facade.value.openings.map((o) => o.kind)).toEqual(["door"]);
    });

    test("an empty pick is refused", () => {
        const result = extractFacade([], { side: "south", window: WINDOW });
        expect(result.isOk).toBe(false);
    });

    test("a pick with no wall in it is refused and says so", () => {
        const result = extractFacade([line(0, 0, 6000, 0)], { side: "south", window: WINDOW });
        expect(result.isOk).toBe(false);
        expect(result.error).toContain("No wall");
    });

    test("the refusal quotes the faces it found and how far apart they are", () => {
        // Which of the three tests failed is the whole of what is useful, and all three
        // fail with the same word. Here it is the thickness: two good long faces, two
        // metres apart, which is a room and not a wall.
        const result = extractFacade([line(0, 0, 6000, 0), line(0, 2000, 6000, 2000)], {
            side: "south",
            window: box(-500, -500, 6500, 3000),
        });
        expect(result.isOk).toBe(false);
        expect(result.error).toContain("0 in, 6000 long");
        expect(result.error).toContain("2000 in, 6000 long");
        expect(result.error).toContain("between 50 and 600 apart");
    });

    test("a plan read at the wrong scale is told so, rather than handed millimetre gaps", () => {
        // The real shape of a units mismatch: a plan drawn in metres and read as
        // millimetres. The wall is 9.144 across and 0.23 thick, so its two faces land
        // inside the band tolerance and merge, and no arrangement of the rules can find a
        // wall. The face list would be arithmetically perfect and no use to anybody.
        const tiny = [line(0, 0, 9.144, 0), line(0, 0.23, 9.144, 0.23)];
        const result = extractFacade(tiny, { side: "south", window: box(-1, -1, 10, 10) });

        expect(result.isOk).toBe(false);
        expect(result.error).toContain("too small to be a building");
        expect(result.error).toContain("units");
    });

    test("a pick read from the wrong side says nothing runs along it, not that it is not a wall", () => {
        // The commonest way to see this message is to have chosen the wrong side, and
        // "no faces at all" is what tells that apart from a wall it could not measure.
        // Two horizontal lines, read from the east. Nothing in the pick runs north-south,
        // so there is not even a candidate face to measure - a different failure from a
        // face that was found and rejected.
        const result = extractFacade([line(0, 0, 6000, 0), line(0, 230, 6000, 230)], {
            side: "east",
            window: WINDOW,
        });
        expect(result.isOk).toBe(false);
        expect(result.error).toContain("run along that side");
    });

    test("polylines read the same as the lines they are made of", () => {
        const drawn: DrawItem[] = [
            {
                kind: "polyline",
                layer: "WALL",
                points: [
                    { x: 0, y: 0 },
                    { x: 1000, y: 0 },
                ],
                closed: false,
            },
            {
                kind: "polyline",
                layer: "WALL",
                points: [
                    { x: 2000, y: 0 },
                    { x: 6000, y: 0 },
                ],
                closed: false,
            },
            {
                kind: "polyline",
                layer: "WALL",
                points: [
                    { x: 0, y: 230 },
                    { x: 1000, y: 230 },
                ],
                closed: false,
            },
            {
                kind: "polyline",
                layer: "WALL",
                points: [
                    { x: 2000, y: 230 },
                    { x: 6000, y: 230 },
                ],
                closed: false,
            },
            line(1000, 0, 1000, 230),
            line(2000, 0, 2000, 230),
        ];
        const facade = extractFacade(drawn, { side: "south", window: WINDOW });
        expect(facade.value.widthMm).toBe(6000);
        expect(facade.value.openings).toEqual([{ kind: "door", centerMm: 1500, widthMm: 1000 }]);
    });

    test("ignoreLayers drops geometry before it is read", () => {
        const facade = extractFacade(wallFixture(), {
            side: "south",
            window: WINDOW,
            ignoreLayers: new Set(["WINDOW"]),
        });
        expect(facade.value.openings.map((o) => o.kind)).toEqual(["door"]);
    });
});

describe("sides", () => {
    /** The fixture wall turned to face each way, so one drawing can be read from all four. */
    function rotated(side: FacadeSide): DrawItem[] {
        const turn = { south: 0, east: 90, north: 180, west: 270 }[side];
        const rad = (turn * Math.PI) / 180;
        const cos = Math.round(Math.cos(rad));
        const sin = Math.round(Math.sin(rad));
        const at = (p: { x: number; y: number }) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });

        return wallFixture().map((item) => {
            if (item.kind === "line") return { ...item, a: at(item.a), b: at(item.b) };
            if (item.kind === "arc") return { ...item, center: at(item.center), start: at(item.start) };
            return item;
        });
    }

    for (const side of ["south", "east", "north", "west"] as FacadeSide[]) {
        test(`the ${side} face reads the same as the south face it was turned from`, () => {
            const facade = extractFacade(rotated(side), { side, window: box(-7000, -7000, 7000, 7000) });
            expect(facade.value.widthMm).toBe(6000);
            expect(facade.value.wallThicknessMm).toBeCloseTo(230, 6);
            expect(facade.value.openings).toEqual([
                { kind: "door", centerMm: 1500, widthMm: 1000, hinge: "left" },
                { kind: "window", centerMm: 4000, widthMm: 1200 },
            ]);
        });
    }

    test("reading the same wall from behind mirrors it", () => {
        // The one that catches a sign error in the viewer's axes: seen from the other
        // side, the door 1500 from the left end is 4500 from it, and the hand swaps.
        const facade = extractFacade(wallFixture(), { side: "north", window: WINDOW });
        expect(facade.value.openings).toEqual([
            { kind: "window", centerMm: 2000, widthMm: 1200 },
            { kind: "door", centerMm: 4500, widthMm: 1000, hinge: "right" },
        ]);
    });
});

describe("a real floor plan, read back", () => {
    const spec: FloorPlanSpec = { ...DEFAULT_SPEC, entrySide: "front" };
    const ir = generateFloorPlan(spec).value;
    const items = buildDrawing(ir, ctx);
    const window = box(ir.outer.x0 - 1000, ir.outer.y0 - 1000, ir.outer.x1 + 1000, ir.outer.y1 + 1000);

    test("the entry facade comes back the width the plan drew it", () => {
        const facade = extractFacade(items, { side: "south", window });
        expect(facade.value.widthMm).toBeCloseTo(ir.outer.x1 - ir.outer.x0, 6);
        expect(facade.value.wallThicknessMm).toBeCloseTo(spec.externalWallMm, 6);
    });

    test("every door and window the plan hung on that wall is found, and nothing else", () => {
        const wall = ir.walls.find((w) => w.id === "ext.south")!;
        const expected = wall.openings
            .filter((o) => o.kind !== "junction")
            .map((o) => ({ kind: o.kind, x: wallPoint(wall, o.centerMm).x, widthMm: o.widthMm }))
            .sort((p, q) => p.x - q.x);

        const facade = extractFacade(items, { side: "south", window });
        const found = facade.value.openings.map((o) => ({
            kind: o.kind,
            x: facade.value.origin.x + o.centerMm,
            widthMm: o.widthMm,
        }));

        expect(found.length).toBe(expected.length);
        for (const [i, opening] of found.entries()) {
            expect(opening.kind).toBe(expected[i].kind);
            expect(opening.x).toBeCloseTo(expected[i].x, 6);
            expect(opening.widthMm).toBeCloseTo(expected[i].widthMm, 6);
        }
    });

    test("the corner returns and the partitions meeting the wall are not read as openings", () => {
        const facade = extractFacade(items, { side: "south", window });
        expect(facade.value.unpairedJambs).toBe(0);
    });

    test("all four faces of the building read as walls", () => {
        for (const side of ["south", "east", "north", "west"] as FacadeSide[]) {
            const facade = extractFacade(items, { side, window });
            expect(facade.isOk).toBe(true);
            expect(facade.value.wallThicknessMm).toBeCloseTo(spec.externalWallMm, 6);
        }
    });
});
