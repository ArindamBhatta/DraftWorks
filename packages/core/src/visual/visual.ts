import type { IDocument } from "../document";
import type { IDisposable } from "../foundation";
import type { Plane } from "../math";
import type { IEventHandler } from "./eventHandler";
import type { IHighlighter } from "./highlighter";
import type { IMeshExporter } from "./meshExporter";
import type { IView } from "./view";
import type { IVisualContext } from "./visualContext";

/**
 * `IVisual` is the top-level "rendering engine instance" contract for one open document — it's
 * what turns an abstract CAD document into pixels on screen and mouse clicks into model edits.
 *
 * The `core` package defines only this INTERFACE, not an implementation: it deliberately doesn't
 * know or care whether the actual drawing is done with three.js, another WebGL engine, or
 * something else entirely. A concrete renderer (e.g. `packages/three`) implements `IVisual`, and
 * an `IVisualFactory` (see `visualFactory.ts`) is what plugs a concrete implementation in at
 * runtime. This is what lets the geometry/command/document logic in `core` stay completely
 * decoupled from any specific graphics library.
 */
export interface IVisual extends IDisposable {
    /** The document this visual is rendering — the single source of truth; the visual is just its on-screen projection. */
    readonly document: IDocument;
    /** The 3D scene/world: add/remove renderable objects, display tessellated meshes, run spatial queries. See `visualContext.ts`. */
    readonly context: IVisualContext;
    /** Drives hover/selection highlighting feedback (e.g. lighting up an edge under the cursor). */
    readonly highlighter: IHighlighter;
    /** Exports the current tessellated scene data (e.g. for saving a mesh format). */
    readonly meshExporter: IMeshExporter;
    /** Requests a re-render of the current frame. */
    update(): void;
    /**
     * A stack of pluggable mouse/keyboard handlers: `defaultEventHandler` is the idle-state
     * behavior (orbit/pan/zoom, hover, click-to-select), and `eventHandler` is whichever handler is
     * currently active — swapped out while a command is running (e.g. the Mirror command's
     * point-picking steps take over input until it finishes). `viewHandler` handles view-level
     * (camera) input directly.
     */
    viewHandler: IEventHandler;
    defaultEventHandler: IEventHandler;
    eventHandler: IEventHandler;
    /** Creates a new viewport/view looking at a given reference `workplane` (e.g. for a multi-view layout, or a view aligned to a sketch plane). */
    createView(name: string, workplane: Plane): IView;
}
