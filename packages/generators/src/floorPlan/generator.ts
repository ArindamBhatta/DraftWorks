import { Result } from "@draftworks/core";
import {
    coerceParams,
    type Generator,
    type GeneratorError,
    generatorError,
    type ParamDef,
} from "../registry";
import type { DrawItem } from "../types";
import { DEFAULT_SPEC, FLOOR_PLAN_LAYERS } from "./defaults";
import { buildDrawing } from "./drawing";
import { layout, MAX_BEDROOMS, MIN_BEDROOMS, roomsOf } from "./layout";
import { placeOpenings } from "./openings";
import { ENTRY_SIDES, type EntrySide, type FloorPlanIR, type FloorPlanSpec } from "./plan";
import { transformIR } from "./transform";
import { buildWalls, sortOpenings } from "./walls";

// Descriptions are prompt text: they are what the router reads to decide what belongs
// here, so they say what a draftsman would say rather than what the type is.
const PARAMS: ParamDef[] = [
    {
        name: "plotWidthMm",
        type: "length",
        description: 'Width of the plot along the road, e.g. "30\'" or "9000".',
        required: true,
        min: 1000,
        max: 200000,
    },
    {
        name: "plotDepthMm",
        type: "length",
        description: 'Depth of the plot away from the road, e.g. "40\'" or "12000".',
        required: true,
        min: 1000,
        max: 200000,
    },
    {
        name: "bedrooms",
        type: "integer",
        description: `Number of bedrooms. "2BHK" means 2. ${MIN_BEDROOMS} to ${MAX_BEDROOMS}.`,
        required: true,
        default: DEFAULT_SPEC.bedrooms,
        min: MIN_BEDROOMS,
        max: MAX_BEDROOMS,
    },
    {
        name: "entrySide",
        type: "enum",
        description:
            "Which edge of the plot the road and main entrance are on. Use 'front' unless " +
            "the draftsman names a direction relative to the plot.",
        required: false,
        default: DEFAULT_SPEC.entrySide,
        values: ENTRY_SIDES,
    },
    setback("setbackFrontMm", "front", DEFAULT_SPEC.setbackFrontMm),
    setback("setbackRearMm", "rear", DEFAULT_SPEC.setbackRearMm),
    setback("setbackLeftMm", "left", DEFAULT_SPEC.setbackLeftMm),
    setback("setbackRightMm", "right", DEFAULT_SPEC.setbackRightMm),
    length("externalWallMm", "Thickness of the external walls.", DEFAULT_SPEC.externalWallMm, 75, 600),
    length("internalWallMm", "Thickness of the internal partitions.", DEFAULT_SPEC.internalWallMm, 50, 400),
    length("doorWidthMm", "Width of the bedroom and kitchen doors.", DEFAULT_SPEC.doorWidthMm, 600, 1500),
    length("bathDoorWidthMm", "Width of the bathroom doors.", DEFAULT_SPEC.bathDoorWidthMm, 500, 1200),
    length("entryDoorWidthMm", "Width of the main entrance door.", DEFAULT_SPEC.entryDoorWidthMm, 700, 2000),
    length("windowWidthMm", "Widest window in a habitable room.", DEFAULT_SPEC.windowWidthMm, 450, 4000),
    length("bathWindowWidthMm", "Widest window in a bathroom.", DEFAULT_SPEC.bathWindowWidthMm, 300, 1500),
    length("textHeightMm", "Cap height of the room labels at 1:1.", DEFAULT_SPEC.textHeightMm, 10, 2000),
];

function setback(name: string, edge: string, value: number): ParamDef {
    return {
        name,
        type: "length",
        description: `Setback from the ${edge} plot boundary to the building.`,
        required: false,
        default: value,
        min: 0,
        max: 50000,
    };
}

function length(name: string, description: string, value: number, min: number, max: number): ParamDef {
    return { name, type: "length", description, required: false, default: value, min, max };
}

/** The plot size is the one thing with no sensible default - everything else has one. */
function hasPlotSize(values: Record<string, unknown>): boolean {
    return values["plotWidthMm"] !== undefined && values["plotDepthMm"] !== undefined;
}

/** Runs the whole pipeline and hands back the intermediate representation. */
export function generateFloorPlan(spec: FloorPlanSpec): Result<FloorPlanIR, GeneratorError> {
    const grid = layout(spec);
    if (!grid.isOk) return grid.parse<FloorPlanIR>();

    const rooms = roomsOf(grid.value);
    const walls = buildWalls(grid.value);
    placeOpenings(grid.value, walls, rooms, spec);
    sortOpenings(walls);

    const ir: FloorPlanIR = {
        spec,
        outer: grid.value.outer,
        interior: grid.value.interior,
        walls,
        rooms,
    };
    return Result.ok(transformIR(ir, spec.entrySide));
}

export const floorPlanGenerator: Generator<FloorPlanSpec> = {
    id: "floor_plan",
    title: "Residential floor plan",
    mode: "architectural",
    description:
        "Draws the plan view of a house or flat on a rectangular plot: double-line walls, " +
        "doors with swing arcs, windows, and a name and size label in every room. Choose this " +
        "for any request for a 1BHK/2BHK/3BHK/4BHK plan, a house plan, a flat layout or a " +
        "residential floor plan on a given plot. Plan view only - it draws no elevation, " +
        "section, structural detail or reinforcement.",
    examples: [
        "I have a 30x40 plot, give me a 2BHK plan",
        "3BHK flat on a 40 by 60 site, entry from the south",
        "draw a 2 bedroom house plan, 9m x 12m plot, 1.5m front setback",
        "1BHK plan on a 25x40 plot with 9 inch outer walls",
    ],
    params: PARAMS,
    layers: FLOOR_PLAN_LAYERS,

    coerce(raw, ctx) {
        const coerced = coerceParams(PARAMS, raw, ctx);
        if (!coerced.isOk) return coerced.parse<FloorPlanSpec>();
        const values = coerced.value;
        if (!hasPlotSize(values)) {
            return generatorError<FloorPlanSpec>("missingParam", "The plot size is required.");
        }
        return Result.ok({ ...DEFAULT_SPEC, ...values } as FloorPlanSpec);
    },

    generate(spec, ctx): Result<DrawItem[], GeneratorError> {
        const ir = generateFloorPlan(spec);
        if (!ir.isOk) return ir.parse<DrawItem[]>();
        return Result.ok(buildDrawing(ir.value, ctx));
    },

    summarize(spec, ctx) {
        const side: EntrySide = spec.entrySide;
        return [
            `${spec.bedrooms}BHK`,
            `${ctx.format(spec.plotWidthMm)} x ${ctx.format(spec.plotDepthMm)} plot`,
            `entry from the ${side}`,
            `${ctx.format(spec.externalWallMm)} external walls`,
        ].join(" · ");
    },
};
