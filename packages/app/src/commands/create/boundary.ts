import {
    AsyncController,
    CancelableCommand,
    Combobox,
    command,
    type GeometryNode,
    type I18nKeys,
    type IEdge,
    type IShapeFilter,
    PubSub,
    property,
    SelectNodeStep,
    type ShapeNode,
    ShapeNodeFilter,
    ShapeTypes,
    Transaction,
} from "@draftworks/core";
import { FaceNode } from "../../bodys/face";
import { WireNode } from "../../bodys/wire";

/**
 * What BOUNDARY leaves behind: a single closed polyline tracing the area, or a region -
 * a surface bounded by it. AutoCAD's own two choices, under its own names.
 */
const BoundaryTypes: readonly { readonly display: I18nKeys; readonly region: boolean }[] = [
    { display: "boundary.type.polyline", region: false },
    { display: "boundary.type.region", region: true },
];

/**
 * AutoCAD's BOUNDARY (BO): draw a new object around an area that is already enclosed by
 * other ones, so there is something to offset, measure or hatch as a single object.
 *
 * Two differences from AutoCAD worth knowing. It asks for the objects that enclose the
 * area rather than for a point inside it - picking an internal point means tracing the
 * enclosure out of everything else on screen, which needs a planar arrangement this app
 * does not build. And "region" here is a face, the same thing CONVERT TO FACE makes,
 * because that is what a bounded surface is in the kernel underneath.
 *
 * What it does not do is consume what it traced: the boundary objects stay exactly where
 * they were and the new object is laid over them. That is the whole point of the command
 * - contrast convert.toWire/toFace, which replace their input.
 */
@command({
    key: "create.boundary",
    icon: "icon-toPoly",
})
export class BoundaryCommand extends CancelableCommand {
    @property("boundary.objectType", {
        combobox: Combobox.from(BoundaryTypes.map((t) => t.display)),
    })
    get objectType(): I18nKeys {
        return this.getPrivateValue("objectType", BoundaryTypes[0].display);
    }
    set objectType(value: I18nKeys) {
        this.setProperty("objectType", value);
    }

    protected async executeAsync(): Promise<void> {
        const models = await this.getOrPickBoundary();
        if (!models || models.length === 0) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }

        // Built before the transaction opens, for the same reason HATCH does it: a
        // boundary that does not close is a toast, not a half-applied undo step.
        const node = this.createNode(models);
        if (!node) {
            PubSub.default.pub("showToast", "toast.converter.error");
            return;
        }

        Transaction.execute(this.document, "boundary", () => {
            this.document.modelManager.rootNode.add(node);
            this.document.visual.update();
            PubSub.default.pub("showToast", "toast.success");
        });
    }

    /** The traced boundary, or undefined if the picked curves do not close a region. */
    private createNode(models: ShapeNode[]): GeometryNode | undefined {
        const edges = models.map((x) => x.shape.value.transformedMul(x.worldTransform())) as IEdge[];
        const region = BoundaryTypes.find((x) => x.display === this.objectType)?.region ?? false;
        try {
            const node = region
                ? new FaceNode({ document: this.document, shapes: edges })
                : new WireNode({ document: this.document, edges });
            return node.generateShape().isOk ? node : undefined;
        } catch {
            // FaceNode throws rather than returning an error when the edges are open.
            return undefined;
        }
    }

    /**
     * Curves only. A face is already the region BOUNDARY would draw, and tracing one
     * would produce a second copy sitting exactly on top of it.
     */
    private shapeFilter(): IShapeFilter {
        return {
            allow: (shape) => shape.shapeType === ShapeTypes.edge || shape.shapeType === ShapeTypes.wire,
        };
    }

    private async getOrPickBoundary(): Promise<ShapeNode[] | undefined> {
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
