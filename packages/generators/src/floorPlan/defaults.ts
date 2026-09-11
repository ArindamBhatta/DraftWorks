import { LAYER_COLOR_BY_THEME } from "@chili3d/core";
import type { LayerSpec } from "../types";

/**
 * Every dimension a draftsman would argue about lives here and nowhere else.
 * All millimetres. Minima are hard - the generator refuses a plot rather than
 * drawing a 900 mm bathroom (see checkFeasible in layout.ts).
 */
export const ROOM_MIN = {
    living: { w: 3300, d: 3600 },
    kitchen: { w: 2100, d: 2400 },
    master: { w: 3000, d: 3000 },
    bedroom: { w: 2400, d: 3000 },
    bath: { w: 1200, d: 1500 },
} as const;

/** Soft ceilings - a room stops growing here and the surplus goes to the living/dining. */
export const ROOM_MAX = {
    kitchen: { w: 2700, d: 3600 },
    master: { d: 4500 },
    bedroom: { w: 3600 },
    bath: { d: 2400 },
} as const;

/** Clear wall needed either side of a door leaf so it is drawable and usable. */
export const DOOR_CLEARANCE = 150;

/** A window is never drawn closer than this to an internal corner. */
export const WINDOW_CORNER_CLEARANCE = 300;

/**
 * Windows are sized as a fraction of their wall, then clamped between these and the
 * spec's own maximum. Bathrooms get their own floor because a bathroom window is a
 * ventilator, and holding it to a habitable room's minimum would mean drawing none.
 */
export const WINDOW_MIN_WIDTH = 750;
export const BATH_WINDOW_MIN_WIDTH = 450;

export const DEFAULT_SPEC = {
    plotWidthMm: 9144, // 30 ft
    plotDepthMm: 12192, // 40 ft
    setbackFrontMm: 1500,
    setbackRearMm: 1200,
    setbackLeftMm: 1200,
    setbackRightMm: 1200,
    bedrooms: 2,
    entrySide: "front",
    externalWallMm: 230,
    internalWallMm: 115,
    doorWidthMm: 900,
    bathDoorWidthMm: 750,
    entryDoorWidthMm: 1000,
    windowWidthMm: 1200,
    bathWindowWidthMm: 600,
    textHeightMm: 150,
} as const;

/** Drawing content, not i18n - these are the words that appear on the sheet. */
export const ROOM_NAMES = {
    living: "LIVING / DINING",
    kitchen: "KITCHEN",
    master: "MASTER BEDROOM",
    bedroom: (index: number) => `BEDROOM ${index}`,
    attachedBath: "TOILET 1",
    commonBath: "TOILET 2",
} as const;

export const FLOOR_PLAN_LAYERS: LayerSpec[] = [
    // Walls follow the theme the way layer 0 does, so they read on both backgrounds.
    { tag: "WALL", name: "WALL", color: LAYER_COLOR_BY_THEME },
    { tag: "DOOR", name: "DOOR", color: 0x00ff00 },
    { tag: "WINDOW", name: "WINDOW", color: 0x00ffff },
    { tag: "TEXT", name: "TEXT", color: 0xffff00 },
];
