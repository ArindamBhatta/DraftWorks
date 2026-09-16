import type { GeneratorContext } from "../registry";
import { type Bounds, boundsOf, type DrawItem, type Vec2 } from "../types";
import type { Facade, FacadeOpening } from "./facade";
import type { ElevationSpec } from "./spec";

/** Rough advance width per character, as a fraction of cap height, for centring labels. */
const CHAR_WIDTH_RATIO = 0.6;

/** How deep the frame line sits inside an opening. Enough to read at 1:100. */
const FRAME_MM = 60;

/** Wider than this and a window gets mullions, because nobody glazes it in one sheet. */
const MAX_PANE_MM = 900;

/** How far a window sill projects past its reveal, each side. */
const SILL_PROJECTION_MM = 75;

/** How far the ground line runs past the building, each side. */
const GROUND_EXTENSION_MM = 900;

const DEG_TO_RAD = Math.PI / 180;

/**
 * The heights an elevation is built on, all measured from ground level.
 *
 * Worth naming separately because this is the half of the drawing the plan could not
 * supply. Every horizontal in the result comes from the extracted facade and is exact;
 * every vertical comes from here and is a decision somebody made, which is why the panel
 * asks about them and why they are all in one place rather than scattered through the
 * arithmetic below.
 */
export interface Levels {
    /** Finished floor level of each storey, lowest first. */
    ffl: number[];
    /** Top of the topmost wall - the roof slab, or the eaves. */
    wallTop: number;
    /** Highest line the drawing reaches: a parapet coping, a ridge, or the wall itself. */
    top: number;
}

export function levelsOf(facadeWidthMm: number, spec: ElevationSpec): Levels {
    const ffl: number[] = [];
    for (let storey = 0; storey < spec.storeys; storey++) {
        ffl.push(spec.plinthMm + storey * spec.floorToFloorMm);
    }

    const wallTop = spec.plinthMm + spec.storeys * spec.floorToFloorMm;
    const top =
        spec.roof === "parapet"
            ? wallTop + spec.parapetMm
            : spec.roof === "pitched"
              ? wallTop + ridgeRise(facadeWidthMm, spec)
              : wallTop;

    return { ffl, wallTop, top };
}

/**
 * How far a gable's ridge stands above its eaves.
 *
 * Measured off the overhanging half-span rather than the wall's, because the eaves line
 * is where the slope starts - a roof pitched from the wall face and one pitched from the
 * eaves reach different ridges, and the second is the one that gets built.
 */
function ridgeRise(facadeWidthMm: number, spec: ElevationSpec): number {
    return (facadeWidthMm / 2 + spec.eavesOverhangMm) * Math.tan(spec.roofPitchDeg * DEG_TO_RAD);
}

export function buildElevation(facade: Facade, spec: ElevationSpec, ctx: GeneratorContext): DrawItem[] {
    const items: DrawItem[] = [];
    const levels = levelsOf(facade.widthMm, spec);

    drawGround(facade, spec, items);
    drawShell(facade, spec, levels, items);
    drawRoof(facade, spec, levels, items);

    for (const [storey, ffl] of levels.ffl.entries()) {
        for (const opening of openingsAt(facade, storey)) {
            drawOpening(opening, ffl, spec, items);
        }
    }

    drawLabel(facade, spec, ctx, items);
    return items;
}

const rect = (layer: string, x0: number, y0: number, x1: number, y1: number): DrawItem => ({
    kind: "polyline",
    layer,
    points: [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
    ],
    closed: true,
});

const line = (layer: string, a: Vec2, b: Vec2): DrawItem => ({ kind: "line", layer, a, b });

function drawGround(facade: Facade, spec: ElevationSpec, items: DrawItem[]): void {
    const over = Math.max(GROUND_EXTENSION_MM, facade.widthMm * 0.05);
    items.push(line("GROUND", { x: -over, y: 0 }, { x: facade.widthMm + over, y: 0 }));
}

/**
 * The outline of the building: two ends, the plinth, and the top of the wall.
 *
 * The ends run from ground rather than from floor level. A plinth is what the building
 * stands on and it is visible from outside, so an elevation that starts at the finished
 * floor draws a house hovering above its own ground line.
 */
function drawShell(facade: Facade, spec: ElevationSpec, levels: Levels, items: DrawItem[]): void {
    const top = spec.roof === "parapet" ? levels.wallTop + spec.parapetMm : levels.wallTop;

    items.push(line("WALL", { x: 0, y: 0 }, { x: 0, y: top }));
    items.push(line("WALL", { x: facade.widthMm, y: 0 }, { x: facade.widthMm, y: top }));
    items.push(line("WALL", { x: 0, y: spec.plinthMm }, { x: facade.widthMm, y: spec.plinthMm }));

    // Not under a pitched roof: there the eaves line runs along the top of the wall and
    // past it on both sides, so drawing this one too would leave the drawing carrying two
    // lines on top of each other - which is a defect in a drawing someone will trim,
    // offset and export, not merely an untidy screen.
    if (spec.roof !== "pitched") {
        items.push(line("WALL", { x: 0, y: levels.wallTop }, { x: facade.widthMm, y: levels.wallTop }));
    }
}

function drawRoof(facade: Facade, spec: ElevationSpec, levels: Levels, items: DrawItem[]): void {
    if (spec.roof === "flat") return;

    if (spec.roof === "parapet") {
        // The coping. The wall itself is already drawn up to it by drawShell; this is the
        // capping stone on top, which is what tells a parapet from a wall left unfinished.
        const top = levels.wallTop + spec.parapetMm;
        items.push(line("ROOF", { x: 0, y: top }, { x: facade.widthMm, y: top }));
        return;
    }

    const eaves = spec.eavesOverhangMm;
    const ridgeX = facade.widthMm / 2;
    const ridgeY = levels.wallTop + ridgeRise(facade.widthMm, spec);

    items.push(
        line("ROOF", { x: -eaves, y: levels.wallTop }, { x: ridgeX, y: ridgeY }),
        line("ROOF", { x: facade.widthMm + eaves, y: levels.wallTop }, { x: ridgeX, y: ridgeY }),
        line("ROOF", { x: -eaves, y: levels.wallTop }, { x: facade.widthMm + eaves, y: levels.wallTop }),
    );
}

/**
 * The openings on one storey.
 *
 * A door is a door on the ground floor and a window everywhere above it. The plan being
 * read is one floor, so upper storeys can only repeat it, and repeating the front door
 * puts a doorway in mid-air on the first floor - which is worse than the small liberty of
 * glazing it, because it is a mistake rather than an assumption.
 */
export function openingsAt(facade: Facade, storey: number): FacadeOpening[] {
    if (storey === 0) return facade.openings;
    return facade.openings.map((opening) =>
        opening.kind === "door"
            ? { kind: "window", centerMm: opening.centerMm, widthMm: opening.widthMm }
            : opening,
    );
}

function drawOpening(opening: FacadeOpening, ffl: number, spec: ElevationSpec, items: DrawItem[]): void {
    const layer = opening.kind === "door" ? "DOOR" : "WINDOW";
    const x0 = opening.centerMm - opening.widthMm / 2;
    const x1 = opening.centerMm + opening.widthMm / 2;
    const head = ffl + spec.lintelMm;
    const foot = opening.kind === "door" ? ffl : ffl + spec.sillMm;

    items.push(rect(layer, x0, foot, x1, head));

    // The frame, as a second outline set in from the reveal. Two lines is what makes an
    // opening read as a thing fitted into a hole rather than as a hole.
    const inset = Math.min(FRAME_MM, opening.widthMm / 6, (head - foot) / 6);
    items.push(rect(layer, x0 + inset, foot + inset, x1 - inset, head - inset));

    if (opening.kind === "window") {
        items.push(
            line("WINDOW", { x: x0 - SILL_PROJECTION_MM, y: foot }, { x: x1 + SILL_PROJECTION_MM, y: foot }),
        );

        const panes = Math.ceil(opening.widthMm / MAX_PANE_MM);
        for (let i = 1; i < panes; i++) {
            const x = x0 + (opening.widthMm * i) / panes;
            items.push(line("WINDOW", { x, y: foot + inset }, { x, y: head - inset }));
        }
    }
}

function drawLabel(facade: Facade, spec: ElevationSpec, ctx: GeneratorContext, items: DrawItem[]): void {
    const text = `${facade.side.toUpperCase()} ELEVATION`;
    const height = spec.textHeightMm;
    items.push({
        kind: "text",
        layer: "TEXT",
        // Centred by advance width, the same approximation the plan's room labels use -
        // the renderer lays the text out for real and nothing here can ask it in advance.
        at: { x: facade.widthMm / 2 - (text.length * height * CHAR_WIDTH_RATIO) / 2, y: -height * 3 },
        text,
        heightMm: height,
        rotationDeg: 0,
    });
}

/** Moves a finished drawing bodily, with no scaling and no re-layout. */
export function translateItems(items: DrawItem[], by: Vec2): DrawItem[] {
    const at = (p: Vec2): Vec2 => ({ x: p.x + by.x, y: p.y + by.y });

    return items.map((item) => {
        switch (item.kind) {
            case "line":
                return { ...item, a: at(item.a), b: at(item.b) };
            case "arc":
                return { ...item, center: at(item.center), start: at(item.start) };
            case "circle":
            case "ellipse":
                return { ...item, center: at(item.center) };
            case "polyline":
                return { ...item, points: item.points.map(at) };
            case "text":
                return { ...item, at: at(item.at) };
        }
    });
}

/**
 * Where to put the elevation relative to the plan it was read from: under it, left edges
 * aligned, clear of it by `gapMm`.
 *
 * Under, rather than projected true beneath each opening. A south elevation would line up
 * exactly - its left end is the plan's left end and it reads the same way along the sheet -
 * but the other three do not: seen from the north, the building's left end is the plan's
 * right end, and projecting it down the sheet would put the drawing on the paper mirrored.
 * Laying all four out the same way is worth more than a true projection on one of them,
 * and the facade's world origin is on the Facade for whoever wants to do better later.
 */
export function placementBelow(items: DrawItem[], window: Bounds, gapMm: number): Vec2 {
    const bounds = boundsOf(items);
    return {
        x: window.min.x - bounds.min.x,
        y: window.min.y - gapMm - bounds.max.y,
    };
}
