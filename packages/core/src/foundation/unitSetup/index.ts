/**
 * CAD unit setup - the drawing-wide settings AutoCAD's new-drawing flow walks through
 * in order: unit format first (UnitSetup), then dimension style (DimensionSetup).
 * MvSetup (sheet layout) lives here too but has no UI yet - see the note on the class.
 * Grouped in their own subfolder because they
 * are the one commit (#11) in the foundation layer that is CAD-specific - everything
 * else here (observer, collection, history, pubsub, gc, signal, ...) is generic editor
 * infrastructure that owes nothing to CAD.
 */

export * from "./drawingSetup";
export * from "./unitSetup";
