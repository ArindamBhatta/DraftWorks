import { LAYER_COLOR_BY_THEME, Result } from "@draftworks/core";
import {
    coerceParams,
    type GeneratorContext,
    type GeneratorError,
    generatorError,
    type ParamDef,
} from "../registry";
import type { LayerSpec } from "../types";
import type { Facade } from "./facade";

/**
 * Everything an elevation needs that the plan does not contain.
 *
 * This is the honest shape of the feature. A plan holds no vertical information at all -
 * not how high the floor is, not where the sill sits, not whether there is a roof on it -
 * so every field here is a decision rather than a measurement. The extracted facade
 * supplies the other half, and between them the drawing is determined.
 *
 * Which is also why this is not a registered Generator. The registry's contract is that a
 * generator draws from its parameters alone, and the router picks one by reading their
 * descriptions; half of this drawing comes off the canvas instead. The pieces a generator
 * is made of are all here and exported separately - the parameters, the coercion, the
 * layers, the summary - so the panel and the router can use them the same way, without
 * the registry promising something that is not true.
 */
export interface ElevationSpec {
    /** 1 or more. Upper storeys repeat the plan they were read from. */
    storeys: number;
    /** Ground level to finished floor level. */
    plinthMm: number;
    floorToFloorMm: number;
    /** Finished floor to window sill. */
    sillMm: number;
    /** Finished floor to the head of every opening on that storey. */
    lintelMm: number;
    roof: RoofKind;
    /** parapet only: how far the wall stands above the roof slab. */
    parapetMm: number;
    /** pitched only. */
    roofPitchDeg: number;
    /** pitched only: how far the eaves overhang the wall, each side. */
    eavesOverhangMm: number;
    textHeightMm: number;
}

export const ROOF_KINDS = ["parapet", "flat", "pitched"] as const;
export type RoofKind = (typeof ROOF_KINDS)[number];

/**
 * Ordinary residential dimensions, in millimetres. A 2100 lintel is a door height, and
 * every opening on a storey heading at the same level is what a lintel band is.
 */
export const DEFAULT_ELEVATION: ElevationSpec = {
    storeys: 1,
    plinthMm: 600,
    floorToFloorMm: 3000,
    sillMm: 900,
    lintelMm: 2100,
    roof: "parapet",
    parapetMm: 1000,
    roofPitchDeg: 22,
    eavesOverhangMm: 450,
    textHeightMm: 150,
};

/**
 * WALL, DOOR, WINDOW and TEXT are named exactly as the floor plan names them, so an
 * elevation drawn beside the plan it came from lands on the plan's own layers rather than
 * scattering the drawing across WALL1 and DOOR1.
 */
export const ELEVATION_LAYERS: LayerSpec[] = [
    { tag: "WALL", name: "WALL", color: LAYER_COLOR_BY_THEME },
    { tag: "DOOR", name: "DOOR", color: 0x00ff00 },
    { tag: "WINDOW", name: "WINDOW", color: 0x00ffff },
    { tag: "ROOF", name: "ROOF", color: 0xff8000 },
    { tag: "GROUND", name: "GROUND", color: 0x808080 },
    { tag: "TEXT", name: "TEXT", color: 0xffff00 },
];

const length = (name: string, description: string, value: number, min: number, max: number): ParamDef => ({
    name,
    type: "length",
    description,
    required: false,
    default: value,
    min,
    max,
});

// Descriptions are prompt text: the model reads them to decide what to answer, and the
// panel shows the same words beside the same boxes. They say what a draftsman would ask.
export const ELEVATION_PARAMS: ParamDef[] = [
    {
        name: "storeys",
        type: "integer",
        description:
            "How many floors the building has. The plan being read is one floor, so the " +
            "storeys above it repeat its openings.",
        required: false,
        default: DEFAULT_ELEVATION.storeys,
        min: 1,
        max: 8,
    },
    length(
        "floorToFloorMm",
        "Floor to floor height - finished floor of one storey to finished floor of the next.",
        DEFAULT_ELEVATION.floorToFloorMm,
        2100,
        6000,
    ),
    length(
        "plinthMm",
        "Height of the plinth: ground level up to the finished floor of the ground storey.",
        DEFAULT_ELEVATION.plinthMm,
        0,
        3000,
    ),
    length(
        "sillMm",
        "Finished floor up to the window sill. Doors ignore it - they start at the floor.",
        DEFAULT_ELEVATION.sillMm,
        0,
        2000,
    ),
    length(
        "lintelMm",
        "Finished floor up to the head of the doors and windows. Usually the door height.",
        DEFAULT_ELEVATION.lintelMm,
        1500,
        4000,
    ),
    {
        name: "roof",
        type: "enum",
        description:
            "What tops the building. 'parapet' is a flat roof with the wall carried up " +
            "around it and is the common case; 'flat' stops at the slab; 'pitched' draws a " +
            "gable over the facade.",
        required: false,
        default: DEFAULT_ELEVATION.roof,
        values: ROOF_KINDS,
    },
    length(
        "parapetMm",
        "Parapet roofs only: how far the wall stands above the roof slab.",
        DEFAULT_ELEVATION.parapetMm,
        150,
        2000,
    ),
    {
        name: "roofPitchDeg",
        type: "number",
        description: "Pitched roofs only: the slope in degrees from horizontal.",
        required: false,
        default: DEFAULT_ELEVATION.roofPitchDeg,
        min: 5,
        max: 60,
    },
    length(
        "eavesOverhangMm",
        "Pitched roofs only: how far the eaves overhang the wall on each side.",
        DEFAULT_ELEVATION.eavesOverhangMm,
        0,
        2000,
    ),
    length(
        "textHeightMm",
        "Cap height of the drawing's title at 1:1.",
        DEFAULT_ELEVATION.textHeightMm,
        10,
        2000,
    ),
];

/**
 * Validates the heights and fills in what was not answered.
 *
 * The three checks are the ones that produce a drawing rather than a refusal: an opening
 * with its head below its sill, a lintel band standing above the floor it belongs to, and
 * a facade with no width. Each would draw something - inverted, overlapping, or nothing at
 * all - and a drawing someone builds from is worse wrong than absent.
 */
export function coerceElevation(
    raw: Record<string, unknown>,
    ctx: GeneratorContext,
): Result<ElevationSpec, GeneratorError> {
    const coerced = coerceParams(ELEVATION_PARAMS, raw, ctx);
    if (!coerced.isOk) return coerced.parse<ElevationSpec>();

    const spec = { ...DEFAULT_ELEVATION, ...coerced.value } as ElevationSpec;

    if (spec.lintelMm <= spec.sillMm) {
        return generatorError<ElevationSpec>(
            "lintelBelowSill",
            "The lintel has to be above the sill, or the windows have no height.",
            { lintelMm: spec.lintelMm, sillMm: spec.sillMm },
        );
    }

    if (spec.lintelMm >= spec.floorToFloorMm) {
        return generatorError<ElevationSpec>(
            "lintelAboveFloor",
            "The lintel has to sit below the floor above it.",
            { lintelMm: spec.lintelMm, floorToFloorMm: spec.floorToFloorMm },
        );
    }

    return Result.ok(spec);
}

export function checkFacade(facade: Facade): Result<Facade, GeneratorError> {
    if (facade.widthMm <= 0) {
        return generatorError<Facade>("emptyFacade", "That facade has no width.");
    }
    return Result.ok(facade);
}

export function summarizeElevation(facade: Facade, spec: ElevationSpec, ctx: GeneratorContext): string {
    const openings = facade.openings.length;
    return [
        `${facade.side} elevation`,
        `${ctx.format(facade.widthMm)} wide`,
        spec.storeys === 1 ? "single storey" : `${spec.storeys} storeys`,
        `${openings} opening${openings === 1 ? "" : "s"} per floor`,
        `${spec.roof} roof`,
    ].join(" · ");
}
