/**
 * The line rendering style for an edge, matching familiar CAD drafting linetypes:
 * "solid" is CONTINUOUS; the rest are dash/gap patterns
 * of decreasing dash length - "dash" (DASHED), "hidden" (HIDDEN, a finer dash AutoCAD
 * uses for occluded edges), "dot" (DOT).
 *
 * This is purely a display concern — it never affects the underlying geometry, only how an edge is
 * drawn (e.g. "hidden" lets a viewer show construction/occluded edges behind a solid as a fine dashed
 * line, the way traditional drafting distinguishes visible vs. hidden edges). It flows into
 * `EdgeMeshData.lineType` in [meshData.ts](./meshData.ts), where the renderer uses it to choose the
 * dash pattern for that edge's line segments.
 */
export type LineType = "solid" | "dash" | "hidden" | "dot";
