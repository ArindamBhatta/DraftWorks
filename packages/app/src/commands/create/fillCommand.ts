import {
    AsyncController,
    CancelableCommand,
    type GeometryNode,
    type IEdge,
    type IShapeFilter,
    type Material,
    PubSub,
    SelectNodeStep,
    type ShapeNode,
    ShapeNodeFilter,
    ShapeTypes,
    Transaction,
} from "@draftworks/core";
import { FaceNode } from "../../bodys/face";

/**
 * What HATCH and GRADIENT have in common: pick (or take the current selection of) a
 * closed region and paint it with a `Material`. The two differ only in what that
 * material is - a pattern tile for HATCH, a colour ramp for GRADIENT - so that is the
 * one thing a subclass supplies.
 *
 * A boundary reaches this command in one of two shapes, and each is filled differently:
 *
 * - Already a face - geometry that arrived that way, from a DXF/DWG import or a drawing
 *   made before the create commands stopped offering a face toggle. It has a fill
 *   already, so this repaints that fill; adding a second face on top would sit exactly
 *   coplanar with the first and z-fight with it. Nothing drawn here produces a face any
 *   more, so this is the rarer path of the two.
 * - Closed wires/edges - nothing is filling the region yet, so a new `Face` is created to
 *   do it, and the boundary curves are left in place. That is AutoCAD's own model: a
 *   fill is laid over a boundary, not a replacement for it.
 */
export abstract class FillCommand extends CancelableCommand {
    /** What this fill is called on the undo stack. */
    protected abstract get fillName(): string;

    /**
     * The material that paints `node`. Built per region rather than shared, because
     * what a fill looks like can depend on the region's own size - see HatchCommand's
     * textureRepeat.
     */
    protected abstract createMaterial(node: GeometryNode): Material;

    protected async executeAsync(): Promise<void> {
        const models = await this.getOrPickBoundary();
        if (!models || models.length === 0) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }

        const faces = models.filter((x) => x.shape.value.shapeType === ShapeTypes.face);
        const curves = models.filter((x) => x.shape.value.shapeType !== ShapeTypes.face);

        // Built before the transaction opens: FaceNode throws outright on a boundary that
        // does not close, and that belongs in a toast, not in a half-applied undo step.
        const fillFace = curves.length > 0 ? this.faceFromCurves(curves) : undefined;
        if (curves.length > 0 && !fillFace) {
            PubSub.default.pub("showToast", "toast.converter.error");
            return;
        }

        Transaction.execute(this.document, this.fillName, () => {
            faces.forEach((x) => {
                x.materialId = this.createMaterial(x).id;
                // Without this the material is applied to a face nobody draws: a 2D
                // drawing is outlines by default, and `filled` is what opts a region
                // into being painted. See GeometryNode.filled.
                x.filled = true;
            });
            if (fillFace) {
                fillFace.materialId = this.createMaterial(fillFace).id;
                fillFace.filled = true;
                this.document.modelManager.rootNode.add(fillFace);
            }
            this.document.visual.update();
            PubSub.default.pub("showToast", "toast.success");
        });
    }

    /** A face spanning the picked curves, or undefined if they do not bound a region. */
    protected faceFromCurves(curves: ShapeNode[]): FaceNode | undefined {
        const edges = curves.map((x) => x.shape.value.transformedMul(x.worldTransform())) as IEdge[];
        try {
            const face = new FaceNode({ document: this.document, shapes: edges });
            return face.generateShape().isOk ? face : undefined;
        } catch {
            // FaceNode throws rather than returning an error when the edges are open.
            return undefined;
        }
    }

    /**
     * A fill boundary is anything that can bound a region: a face (already one), a closed
     * wire, or edges that join into one. Faces have to be in here - every shape the ribbon
     * draws with "as face" on, which is its default, is one, so leaving them out made HATCH
     * reject the rectangle a user had just drawn and selected.
     */
    protected shapeFilter(): IShapeFilter {
        return {
            allow: (shape) =>
                shape.shapeType === ShapeTypes.edge ||
                shape.shapeType === ShapeTypes.wire ||
                shape.shapeType === ShapeTypes.face,
        };
    }

    protected async getOrPickBoundary(): Promise<ShapeNode[] | undefined> {
        const filter = this.shapeFilter();
        const selected = this.document.selection
            .getSelectedNodes()
            .map((x) => x as ShapeNode)
            .filter((x) => x?.shape?.isOk && filter.allow(x.shape.value, x.transform));
        this.document.selection.clearSelection();
        if (selected.length > 0) return selected;

        const step = new SelectNodeStep("prompt.select.models", {
            filter: new ShapeNodeFilter(filter),
            multiple: true,
        });
        this.controller = new AsyncController();
        const data = await step.execute(this.document, this.controller);
        this.document.selection.clearSelection();
        return data?.nodes as ShapeNode[] | undefined;
    }
}
