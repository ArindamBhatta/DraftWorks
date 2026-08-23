import type { IDisposable } from "../foundation/disposable";
import type { BoundingBox } from "../math/boundingBox";
import type { Matrix4 } from "../math/matrix4";
import type { GeometryNode } from "../model/geometryNode";
import type { VisualNode } from "../model/visualNode";

/**
 * `IVisualObject` is the contract for a single renderable "thing" placed in the 3D scene — the
 * on-screen counterpart of one node in the document's model tree. A rendering backend (e.g. a
 * three.js `Object3D` wrapper) implements this so the rest of `core` can manipulate any renderable
 * object generically, without depending on the specific graphics library underneath.
 */
export interface IVisualObject extends IDisposable {
    /** Locked objects are still visible but excluded from selection/editing. */
    locked: boolean;
    visible: boolean;
    /** This object's own placement matrix (see `Matrix4`) relative to its parent — the "Move/Rotate/Scale" a user applied to it. */
    transform: Matrix4;
    /** The fully accumulated placement in world space — this object's `transform` combined with every ancestor's transform up the hierarchy (parent.multiply(child), chained), so it reflects where the object actually sits in the scene, not just relative to its parent. */
    worldTransform(): Matrix4;
    /** The object's axis-aligned extent in world space, or `undefined` if it has no geometry (e.g. an empty group) — used for zoom-to-fit, box-select intersection tests, and culling. */
    boundingBox(): BoundingBox | undefined;
}

/** A visual object that's backed by a document-tree node, giving a way back from the rendered object to the abstract model node it represents (e.g. to update a tree-view selection when something is clicked in 3D). */
export interface INodeVisual extends IVisualObject {
    get node(): VisualNode;
}

/** A visual object that specifically represents a geometry-bearing node (as opposed to a purely structural/group node with no shape of its own). */
export interface IVisualGeometry extends IVisualObject {
    get geometryNode(): GeometryNode;
}

/** Type guard distinguishing a geometry-bearing visual object from a plain structural one — e.g. before trying to read/tessellate its shape. */
export function isVisualGeometry(obj: IVisualObject): obj is IVisualGeometry {
    return (obj as IVisualGeometry).geometryNode !== undefined;
}
