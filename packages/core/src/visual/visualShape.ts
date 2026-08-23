/**
 * Bit-flag visual states for highlighting/selection feedback on a shape's edges and faces — same
 * combinable-bitmask trick as `ShapeTypes` in `shapeType.ts`: an edge or face can be several of
 * these at once (e.g. hovered AND selected), OR'd together into one number, rather than needing a
 * separate boolean per state.
 */
export const VisualStates = {
    normal: 0,
    edgeHighlight: 1,
    edgeSelected: 2,
    faceTransparent: 4,
    faceHighlight: 8,
    faceSelected: 16,
} as const;
export type VisualState = (typeof VisualStates)[keyof typeof VisualStates];

/** Helpers for combining/testing `VisualState` bitmasks — e.g. the renderer uses these to decide an edge/face's highlight color by checking which state bits are currently set. */
export class VisualStateUtils {
    /** Turns a state ON — e.g. `addState(current, VisualStates.edgeHighlight)` when the mouse hovers an edge. */
    public static addState(origin: VisualState, add: VisualState) {
        return (origin | add) as VisualState;
    }

    /** Turns a state OFF — clears just the `remove` bits from `origin` (keeps every other state untouched), e.g. un-highlighting on mouse-out without losing "selected". */
    public static removeState(origin: VisualState, remove: VisualState) {
        return ((origin & remove) ^ origin) as VisualState;
    }

    /** Checks whether `origin` currently has `testState` set. */
    public static hasState(origin: VisualState, testState: VisualState) {
        return (origin & testState) === testState;
    }
}

/**
 * A sub-range `[start, start + count)` within a merged mesh's index/position buffer that should be
 * treated (colored/highlighted) as one material group — the visual-layer counterpart of
 * `MeshGroup`/`ShapeMeshRange` from `shape/meshData.ts`. This is what lets a single triangle range
 * belonging to one face be recolored for highlighting without touching the rest of a merged mesh.
 */
export interface VisualGroup {
    start: number;
    count: number;
    materialIndex?: number;
}
