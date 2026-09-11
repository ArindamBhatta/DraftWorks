import { Result } from "@chili3d/core";
import { type GeneratorError, generatorError } from "../registry";
import { clamp } from "../units";
import { DOOR_CLEARANCE, ROOM_MAX, ROOM_MIN, ROOM_NAMES } from "./defaults";
import type { FloorPlanSpec, Rect, RoomCell } from "./plan";

/**
 * The parti, in the canonical frame (entry on the -Y edge, "front"):
 *
 *     +-----------------------------+  rear
 *     | BED N .. BED 2 | MASTER BED |
 *     |                |------------|  rear band
 *     |                |  TOILET 1  |
 *     |=============================|  band wall
 *     |                | TOILET 2   |
 *     |    LIVING /    |------------|  front band
 *     |    DINING      |  KITCHEN   |
 *     +-----------------------------+  front (entry)
 *
 * Two vertical partitions - one per band - at independent x positions xF (front) and
 * xR (rear). That independence is the whole trick: the master column is pushed right of
 * the bedrooms, and the front partition xF is pushed right of xR by at least a door's
 * width, so the master bedroom keeps real frontage on the living room and its door has
 * somewhere to go. Every other rear column already sits under the living room.
 *
 * The result: every room touches an external wall (so every room can take a window),
 * every door opens onto the living/dining or onto its parent bedroom, and the interior
 * rectangle is partitioned exactly - no corridor, no leftover void. That is what a
 * beginner draftsman draws for a flat this size, and it is why there is no general
 * space-partitioner here: a fixed topology is deterministic and can be asserted.
 */
export interface SliceGrid {
    outer: Rect;
    interior: Rect;
    externalWallMm: number;
    internalWallMm: number;
    /** Offsets are measured from the interior's left/front edge. */
    xF: number;
    xR: number;
    /** True when there are bedroom columns left of the master column (bedrooms > 1). */
    hasRearSplit: boolean;
    /** x offsets of the partitions between bedroom columns (bedrooms > 2). */
    bedroomSplits: number[];
    dF: number;
    dKit: number;
    dM: number;
    bedrooms: number;
}

export const MIN_BEDROOMS = 1;
export const MAX_BEDROOMS = 4;

/** Minimum front-band depth: the living room, or the kitchen stacked over a toilet. */
function minFrontDepth(t: number): number {
    return Math.max(ROOM_MIN.living.d, ROOM_MIN.kitchen.d + t + ROOM_MIN.bath.d);
}

/** Minimum rear-band depth: a bedroom, or the master stacked over its attached toilet. */
function minRearDepth(t: number): number {
    return Math.max(ROOM_MIN.bedroom.d, ROOM_MIN.master.d + t + ROOM_MIN.bath.d);
}

/** Wall the master bedroom's door needs on the band wall, inside the living room. */
function minMasterFrontage(spec: FloorPlanSpec): number {
    return spec.doorWidthMm + 2 * DOOR_CLEARANCE + spec.internalWallMm;
}

/** Width the bedroom columns need, excluding the master column. */
function minBedroomBandWidth(bedrooms: number, t: number): number {
    const columns = bedrooms - 1;
    if (columns <= 0) return 0;
    return columns * ROOM_MIN.bedroom.w + (columns - 1) * t;
}

export interface Feasibility {
    ok: boolean;
    availableWidthMm: number;
    availableDepthMm: number;
    neededWidthMm: number;
    neededDepthMm: number;
}

/**
 * Whether a plot can hold this plan at all, reported in interior dimensions so the panel
 * can say exactly how much is missing. Exported separately from `layout` so the UI can
 * validate while the draftsman is still typing.
 */
export function checkFeasible(spec: FloorPlanSpec): Feasibility {
    const t = spec.internalWallMm;
    const interior = interiorOf(spec);
    const availableWidthMm = interior.x1 - interior.x0;
    const availableDepthMm = interior.y1 - interior.y0;

    const xRMin = minBedroomBandWidth(spec.bedrooms, t);
    const xFMin = Math.max(
        ROOM_MIN.living.w,
        spec.bedrooms > 1 ? xRMin + minMasterFrontage(spec) : ROOM_MIN.living.w,
    );
    // The kitchen constrains the right of the front band; the master, being further
    // left, is always the looser of the two.
    const neededWidthMm = xFMin + t + ROOM_MIN.kitchen.w;
    const neededDepthMm = minFrontDepth(t) + t + minRearDepth(t);

    return {
        ok: availableWidthMm >= neededWidthMm && availableDepthMm >= neededDepthMm,
        availableWidthMm,
        availableDepthMm,
        neededWidthMm,
        neededDepthMm,
    };
}

function interiorOf(spec: FloorPlanSpec): Rect {
    const T = spec.externalWallMm;
    return {
        x0: spec.setbackLeftMm + T,
        y0: spec.setbackFrontMm + T,
        x1: spec.plotWidthMm - spec.setbackRightMm - T,
        y1: spec.plotDepthMm - spec.setbackRearMm - T,
    };
}

function outerOf(spec: FloorPlanSpec): Rect {
    return {
        x0: spec.setbackLeftMm,
        y0: spec.setbackFrontMm,
        x1: spec.plotWidthMm - spec.setbackRightMm,
        y1: spec.plotDepthMm - spec.setbackRearMm,
    };
}

export function validateSpec(spec: FloorPlanSpec): GeneratorError | undefined {
    if (!(spec.plotWidthMm > 0) || !(spec.plotDepthMm > 0)) {
        return { code: "invalidInput", message: "The plot must have a positive width and depth." };
    }
    if (spec.bedrooms < MIN_BEDROOMS || spec.bedrooms > MAX_BEDROOMS) {
        return {
            code: "invalidInput",
            message: `This generator draws ${MIN_BEDROOMS} to ${MAX_BEDROOMS} bedrooms (1BHK to 4BHK).`,
        };
    }
    if (!(spec.externalWallMm > 0) || !(spec.internalWallMm > 0)) {
        return { code: "invalidInput", message: "Wall thicknesses must be greater than zero." };
    }
    const outer = outerOf(spec);
    if (outer.x1 - outer.x0 <= 2 * spec.externalWallMm || outer.y1 - outer.y0 <= 2 * spec.externalWallMm) {
        return {
            code: "setbacksExceedPlot",
            message: "The setbacks leave no buildable area on this plot.",
        };
    }
    return undefined;
}

/** Solves the slice positions. Pure arithmetic - no geometry, no rounding surprises. */
export function layout(spec: FloorPlanSpec): Result<SliceGrid, GeneratorError> {
    const invalid = validateSpec(spec);
    if (invalid) return generatorError(invalid.code, invalid.message, invalid.detail);

    const feasible = checkFeasible(spec);
    if (!feasible.ok) {
        return tooSmall(feasible);
    }

    const t = spec.internalWallMm;
    const interior = interiorOf(spec);
    const W = interior.x1 - interior.x0;
    const D = interior.y1 - interior.y0;

    // --- depth ---------------------------------------------------------------
    // The rear band is sized first because the master-plus-attached-toilet stack is
    // the least compressible thing in the plan; the front band takes the residual, so
    // any surplus depth lands in the living/dining rather than in a void.
    const dRMin = minRearDepth(t);
    const dRMax = Math.max(dRMin, ROOM_MAX.master.d + t + ROOM_MAX.bath.d);
    let dR = clamp(0.5 * D, dRMin, dRMax);
    let dF = D - t - dR;
    const dFMin = minFrontDepth(t);
    if (dF < dFMin) {
        dR = D - t - dFMin;
        dF = dFMin;
    }
    if (dR < dRMin) return tooSmall(feasible);

    // Kitchen over the common toilet, inside the front band.
    let dKit = clamp(0.6 * dF, ROOM_MIN.kitchen.d, ROOM_MAX.kitchen.d);
    let dT2 = dF - t - dKit;
    if (dT2 < ROOM_MIN.bath.d) {
        dT2 = ROOM_MIN.bath.d;
        dKit = dF - t - dT2;
    } else if (dT2 > ROOM_MAX.bath.d) {
        dT2 = ROOM_MAX.bath.d;
        dKit = dF - t - dT2;
    }
    if (dKit < ROOM_MIN.kitchen.d) return tooSmall(feasible);

    // Master bedroom over its attached toilet, inside the rear band.
    let dM = clamp(0.62 * dR, ROOM_MIN.master.d, ROOM_MAX.master.d);
    let dT1 = dR - t - dM;
    if (dT1 < ROOM_MIN.bath.d) {
        dT1 = ROOM_MIN.bath.d;
        dM = dR - t - dT1;
    } else if (dT1 > ROOM_MAX.bath.d) {
        dT1 = ROOM_MAX.bath.d;
        dM = dR - t - dT1;
    }
    if (dM < ROOM_MIN.master.d) return tooSmall(feasible);

    // --- width ---------------------------------------------------------------
    const hasRearSplit = spec.bedrooms > 1;
    const columns = spec.bedrooms - 1;
    let xR = 0;
    const bedroomSplits: number[] = [];
    if (hasRearSplit) {
        // The frontage rule forces the master column wide - it has to reach far enough
        // left to clear the kitchen and still meet the living room. So size the master
        // to a target and let the bedrooms take everything else, rather than sizing the
        // bedrooms and dumping the whole surplus on the master, which leaves the other
        // bedrooms pinned at their bare minimum on a narrow plot.
        const masterTarget = clamp(0.32 * W, ROOM_MIN.master.w, 3900);
        const xRMin = minBedroomBandWidth(spec.bedrooms, t);
        // Leave room for the kitchen and the master's frontage; shrink the bedrooms
        // toward their minimum before giving up.
        const xRMax = W - t - ROOM_MIN.kitchen.w - minMasterFrontage(spec);
        if (xRMax < xRMin) return tooSmall(feasible);
        xR = clamp(W - t - masterTarget, xRMin, xRMax);
        const each = (xR - (columns - 1) * t) / columns;
        for (let i = 1; i < columns; i++) bedroomSplits.push(i * each + (i - 1) * t);
    }

    const kitchenWidth = clamp(0.34 * W, ROOM_MIN.kitchen.w, ROOM_MAX.kitchen.w);
    const xFMin = Math.max(ROOM_MIN.living.w, hasRearSplit ? xR + minMasterFrontage(spec) : 0);
    const xFMax = W - t - ROOM_MIN.kitchen.w;
    if (xFMax < xFMin) return tooSmall(feasible);
    const xF = clamp(W - t - kitchenWidth, xFMin, xFMax);

    if (W - t - xR < ROOM_MIN.master.w) return tooSmall(feasible);

    return Result.ok({
        outer: outerOf(spec),
        interior,
        externalWallMm: spec.externalWallMm,
        internalWallMm: t,
        xF,
        xR,
        hasRearSplit,
        bedroomSplits,
        dF,
        dKit,
        dM,
        bedrooms: spec.bedrooms,
    });
}

function tooSmall(feasible: Feasibility): Result<SliceGrid, GeneratorError> {
    return generatorError<SliceGrid>("tooSmall", "The buildable area is too small for this plan.", {
        availableWidthMm: feasible.availableWidthMm,
        availableDepthMm: feasible.availableDepthMm,
        neededWidthMm: feasible.neededWidthMm,
        neededDepthMm: feasible.neededDepthMm,
    });
}

/** Derives the room rectangles from a solved grid. They tile the interior exactly. */
export function roomsOf(grid: SliceGrid): RoomCell[] {
    const { interior: i, internalWallMm: t } = grid;
    const bandY = i.y0 + grid.dF; // front face of the band wall
    const rearY0 = bandY + t;
    const kitchenX0 = i.x0 + grid.xF + t;
    const masterX0 = grid.hasRearSplit ? i.x0 + grid.xR + t : i.x0;

    const rooms: RoomCell[] = [
        {
            id: "living",
            kind: "living",
            name: ROOM_NAMES.living,
            rect: { x0: i.x0, y0: i.y0, x1: i.x0 + grid.xF, y1: bandY },
        },
        {
            id: "kitchen",
            kind: "kitchen",
            name: ROOM_NAMES.kitchen,
            rect: { x0: kitchenX0, y0: i.y0, x1: i.x1, y1: i.y0 + grid.dKit },
        },
        {
            id: "bath2",
            kind: "bath",
            name: ROOM_NAMES.commonBath,
            rect: { x0: kitchenX0, y0: i.y0 + grid.dKit + t, x1: i.x1, y1: bandY },
        },
        {
            id: "master",
            kind: "master",
            name: ROOM_NAMES.master,
            rect: { x0: masterX0, y0: rearY0, x1: i.x1, y1: rearY0 + grid.dM },
        },
        {
            id: "bath1",
            kind: "bath",
            name: ROOM_NAMES.attachedBath,
            rect: { x0: masterX0, y0: rearY0 + grid.dM + t, x1: i.x1, y1: i.y1 },
        },
    ];

    if (grid.hasRearSplit) {
        // Bedroom columns run left to right; BEDROOM 2 is the one nearest the master,
        // matching how a draftsman numbers them outward from the main bedroom.
        const edges = [0, ...grid.bedroomSplits.flatMap((s) => [s, s + t]), grid.xR];
        const columnCount = grid.bedrooms - 1;
        for (let c = 0; c < columnCount; c++) {
            const x0 = i.x0 + edges[c * 2];
            const x1 = i.x0 + edges[c * 2 + 1];
            rooms.push({
                id: `bedroom${columnCount - c + 1}`,
                kind: "bedroom",
                name: ROOM_NAMES.bedroom(columnCount - c + 1),
                rect: { x0, y0: rearY0, x1, y1: i.y1 },
            });
        }
    }

    return rooms;
}
