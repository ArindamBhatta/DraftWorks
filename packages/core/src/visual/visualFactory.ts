import type { IDocument } from "../document";
import type { IVisual } from "./visual";

/**
 * The plug-in point that ties a concrete rendering backend into the app: given a document, `create`
 * builds an `IVisual` (a whole rendering engine instance, see `visual.ts`) for it. `kernelName`
 * identifies which engine implements it (e.g. a three.js-based renderer).
 *
 * This is what actually completes the dependency inversion set up by the other files in this
 * folder: `core` only ever talks in terms of `IVisual`/`IVisualContext`/`IVisualObject`, and the
 * app wires in a real implementation at startup by picking a concrete `IVisualFactory` — so
 * swapping the underlying graphics engine, or supporting more than one, doesn't require touching
 * any geometry/command/document code in `core`.
 */
export interface IVisualFactory {
    readonly kernelName: string;
    create(document: IDocument): IVisual;
}
