import type { IDocument } from "../document";
import type { I18nKeys } from "../i18n";
import { type BoundingBox, Matrix4 } from "../math";
import { serialize } from "../serialize";
import { Node } from "./node";

/**
 * A measured, read-only row in the Properties palette's Geometry section - AutoCAD's
 * Delta X/Y/Z, Length and Angle on a line, Diameter and Area on a circle.
 *
 * These are facts about the shape rather than settings on it: they follow from the
 * editable properties above them and cannot be typed into, which is exactly how AutoCAD
 * greys them out. The value stays a number here, tagged with what kind of quantity it
 * is, so the palette can format it in the drawing's own units and precision instead of
 * every node inventing its own `toFixed`.
 */
export interface GeometryFact {
    display: I18nKeys;
    value: number;
    kind: "length" | "angle" | "area";
}

// VisualNode is the layer between plain Node (identity/tree position) and
// GeometryNode (has an actual shape/mesh). It exists so "positioned, transformable,
// has a bounding box" can apply to nodes that don't carry geometry themselves - a
// FolderNode groups children and needs a transform/bounding box for the viewport,
// but has no shape of its own, so it's a VisualNode without being a GeometryNode.
export abstract class VisualNode extends Node {
    // Layer membership is captured at creation, not looked up lazily: a node drawn while
    // BEAM was current must stay on BEAM after the user makes COLUMN current. Storing the
    // id (rather than the Layer itself) keeps the node serializable on its own and lets
    // a layer be renamed or recoloured without touching any node.
    constructor(document: IDocument, name: string, id: string) {
        super(document, name, id);
        this.setPrivateValue("layerId", document.modelManager.currentLayerId);
    }

    @serialize()
    get layerId(): string {
        return this.getPrivateValue("layerId", "");
    }
    set layerId(value: string) {
        this.setProperty("layerId", value);
    }

    // Returns an i18n key rather than a display string so node-type labels (shown in
    // the project tree / properties panel) stay translatable without this model-layer
    // class needing to know which locale is active.
    abstract display(): I18nKeys;

    @serialize()
    get transform(): Matrix4 {
        return this.getPrivateValue("transform", Matrix4.identity());
    }
    set transform(value: Matrix4) {
        this.setProperty("transform", value, undefined, {
            equals: (left, right) => left.equals(right),
        });
    }

    // Delegates to the rendered visual object instead of composing this.transform
    // with the parent chain locally, because the model layer (this class) doesn't
    // walk ancestors to accumulate transforms itself - the render-side scene graph
    // (e.g. Three.js's Object3D tree) already does that composition, and asking it
    // avoids re-implementing "multiply every ancestor's matrix" here. Falls back to
    // the node's own transform only if it isn't in the visual context yet.
    worldTransform(): Matrix4 {
        const visual = this.document.visual.context.getVisual(this);
        if (visual) {
            return visual.worldTransform();
        }
        return this.transform;
    }

    protected onVisibleChanged(): void {
        this.document.visual.context.setVisible(this, this.visible && this.parentVisible);
    }

    protected onParentVisibleChanged(): void {
        this.document.visual.context.setVisible(this, this.visible && this.parentVisible);
    }

    /**
     * The measured rows this node adds to the Geometry section - see GeometryFact.
     * Empty by default: a node only has these if there is something worth measuring
     * about it, and the palette simply shows nothing extra when there isn't.
     *
     * Implementations report in world coordinates (`worldTransform()`), because that is
     * what the palette shows and what the user is measuring against the drawing.
     */
    geometryFacts(): GeometryFact[] {
        return [];
    }

    abstract boundingBox(): BoundingBox | undefined;
}
