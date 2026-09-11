import type { Vec2 } from "../types";
import { LENGTH_EPSILON } from "../units";
import { BATH_WINDOW_MIN_WIDTH, DOOR_CLEARANCE, WINDOW_CORNER_CLEARANCE, WINDOW_MIN_WIDTH } from "./defaults";
import { type Interval, placeInFree, spanOf } from "./intervals";
import type { SliceGrid } from "./layout";
import { type FloorPlanSpec, type Rect, type RoomCell, type WallSegment, wallAxes } from "./plan";

function projectOntoWall(wall: WallSegment, p: Vec2): number {
    const { dir } = wallAxes(wall);
    return (p.x - wall.start.x) * dir.x + (p.y - wall.start.y) * dir.y;
}

function intervalOnWall(wall: WallSegment, a: Vec2, b: Vec2): Interval {
    const sa = projectOntoWall(wall, a);
    const sb = projectOntoWall(wall, b);
    return { lo: Math.min(sa, sb), hi: Math.max(sa, sb) };
}

/** Everything already on a wall, as intervals a new opening must avoid. */
function occupied(wall: WallSegment): Interval[] {
    return wall.openings.map(spanOf);
}

function shrink(span: Interval, by: number): Interval {
    return { lo: span.lo + by, hi: span.hi - by };
}

/**
 * Places a door and returns whether it fit. The hinge goes on the jamb nearer the end
 * of the room's frontage, so the open leaf lies back against a wall instead of standing
 * out across the room.
 */
function addDoor(
    wall: WallSegment,
    frontage: Interval,
    width: number,
    swing: 1 | -1,
): { centerMm: number; hinge: "start" | "end" } | undefined {
    const domain = shrink(frontage, DOOR_CLEARANCE);
    if (domain.hi - domain.lo < width - LENGTH_EPSILON) return undefined;

    const preferred = (domain.lo + domain.hi) / 2;
    const center = placeInFree(domain, occupied(wall), width, preferred);
    if (center === undefined) return undefined;

    const hinge = center - frontage.lo <= frontage.hi - center ? "start" : "end";
    wall.openings.push({ kind: "door", centerMm: center, widthMm: width, hinge, swing });
    return { centerMm: center, hinge };
}

function addWindow(wall: WallSegment, frontage: Interval, minWidth: number, maxWidth: number): boolean {
    // A bathroom's maximum can be below a habitable room's minimum, so the floor never
    // gets to argue with the ceiling.
    const floor = Math.min(minWidth, maxWidth);
    const domain = shrink(frontage, WINDOW_CORNER_CLEARANCE);
    const available = domain.hi - domain.lo;
    if (available < floor) return false;

    const width = Math.min(maxWidth, Math.max(floor, 0.45 * (frontage.hi - frontage.lo)), available);

    const preferred = (domain.lo + domain.hi) / 2;
    const center = placeInFree(domain, occupied(wall), width, preferred);
    if (center === undefined) return false;

    wall.openings.push({ kind: "window", centerMm: center, widthMm: width });
    return true;
}

const corner = (x: number, y: number): Vec2 => ({ x, y });

/**
 * Hangs every door and window on the wall network.
 *
 * Doors first, because a door is not negotiable - a room without one is not a room -
 * and windows then take what wall is left. Every door swings into the room being
 * entered, which is both the drafting convention and what keeps the leaf out of the
 * circulation space.
 */
export function placeOpenings(
    grid: SliceGrid,
    walls: WallSegment[],
    rooms: RoomCell[],
    spec: FloorPlanSpec,
): void {
    const byId = new Map(walls.map((w) => [w.id, w]));
    const room = (id: string) => rooms.find((r) => r.id === id)!.rect;
    const wall = (id: string) => byId.get(id)!;
    const { interior: i } = grid;

    const south = wall("ext.south");
    const east = wall("ext.east");
    const north = wall("ext.north");
    const west = wall("ext.west");
    const front = wall("part.front");
    const band = wall("part.band");
    const masterSplit = wall("part.master");

    const living = room("living");
    const kitchen = room("kitchen");
    const bath2 = room("bath2");
    const master = room("master");
    const bath1 = room("bath1");

    // --- doors ---------------------------------------------------------------
    // Entry, on the front external wall inside the living room. Exterior walls run
    // counter-clockwise, so their left face is the inner one and +1 swings indoors.
    addDoor(
        south,
        intervalOnWall(south, corner(living.x0, i.y0), corner(living.x1, i.y0)),
        spec.entryDoorWidthMm,
        1,
    );

    // Kitchen and common toilet open off the living room through the front partition.
    // Its left face looks at the living room, so swinging into them is -1.
    addDoor(
        front,
        intervalOnWall(front, corner(front.start.x, kitchen.y0), corner(front.start.x, kitchen.y1)),
        spec.doorWidthMm,
        -1,
    );
    addDoor(
        front,
        intervalOnWall(front, corner(front.start.x, bath2.y0), corner(front.start.x, bath2.y1)),
        spec.bathDoorWidthMm,
        -1,
    );

    // The master bedroom opens off the living room through the band wall, on the stretch
    // where the two actually overlap - the layout guarantees that stretch exists.
    const masterFrontage = intervalOnWall(
        band,
        corner(Math.max(master.x0, living.x0), band.start.y),
        corner(Math.min(master.x1, living.x1), band.start.y),
    );
    addDoor(band, masterFrontage, spec.doorWidthMm, 1);

    // The attached toilet opens off the master bedroom.
    addDoor(
        masterSplit,
        intervalOnWall(
            masterSplit,
            corner(bath1.x0, masterSplit.start.y),
            corner(bath1.x1, masterSplit.start.y),
        ),
        spec.bathDoorWidthMm,
        1,
    );

    // The remaining bedrooms all sit under the living room, so each opens off the band
    // wall along its own column.
    for (const bedroom of rooms.filter((r) => r.kind === "bedroom")) {
        addDoor(
            band,
            intervalOnWall(
                band,
                corner(bedroom.rect.x0, band.start.y),
                corner(bedroom.rect.x1, band.start.y),
            ),
            spec.doorWidthMm,
            1,
        );
    }

    // --- windows -------------------------------------------------------------
    // Every room touches at least one external wall by construction; each takes its
    // longest external run.
    const exteriorRuns = (rect: Rect): { wall: WallSegment; span: Interval }[] => {
        const runs: { wall: WallSegment; span: Interval }[] = [];
        if (Math.abs(rect.y0 - i.y0) < LENGTH_EPSILON) {
            runs.push({
                wall: south,
                span: intervalOnWall(south, corner(rect.x0, i.y0), corner(rect.x1, i.y0)),
            });
        }
        if (Math.abs(rect.y1 - i.y1) < LENGTH_EPSILON) {
            runs.push({
                wall: north,
                span: intervalOnWall(north, corner(rect.x0, i.y1), corner(rect.x1, i.y1)),
            });
        }
        if (Math.abs(rect.x0 - i.x0) < LENGTH_EPSILON) {
            runs.push({
                wall: west,
                span: intervalOnWall(west, corner(i.x0, rect.y0), corner(i.x0, rect.y1)),
            });
        }
        if (Math.abs(rect.x1 - i.x1) < LENGTH_EPSILON) {
            runs.push({
                wall: east,
                span: intervalOnWall(east, corner(i.x1, rect.y0), corner(i.x1, rect.y1)),
            });
        }
        return runs.sort((a, b) => b.span.hi - b.span.lo - (a.span.hi - a.span.lo));
    };

    for (const cell of rooms) {
        const isBath = cell.kind === "bath";
        const maxWidth = isBath ? spec.bathWindowWidthMm : spec.windowWidthMm;
        const minWidth = isBath ? BATH_WINDOW_MIN_WIDTH : WINDOW_MIN_WIDTH;
        for (const run of exteriorRuns(cell.rect)) {
            if (addWindow(run.wall, run.span, minWidth, maxWidth)) break;
        }
    }
}
