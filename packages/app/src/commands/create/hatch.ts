import {
    AsyncController,
    CancelableCommand,
    Combobox,
    command,
    type GeometryNode,
    I18n,
    type I18nKeys,
    type IEdge,
    type IShapeFilter,
    Material,
    PubSub,
    property,
    SelectNodeStep,
    type ShapeNode,
    ShapeNodeFilter,
    ShapeTypes,
    Transaction,
    VisualConfig,
    XY,
} from "@chili3d/core";
import { FaceNode } from "../../bodys/face";
import { HATCH_BASE_TILE_SIZE, HatchPatterns, hatchPatternTexture } from "./hatchPatterns";

/**
 * AutoCAD's HATCH (H/BH): pick a pattern, pick (or use the current selection of) a closed
 * region, and it fills it. The fill is a `Material` whose texture is a generated pattern
 * tile (see hatchPatterns.ts); "Solid" is the one exception, needing no texture at all,
 * since an untextured Material already is a solid fill. Re-running HATCH with the same
 * pattern and scale reuses that material rather than making a new one every time.
 *
 * A boundary reaches this command in one of two shapes, and each is hatched differently:
 *
 * - Already a face (a rect/circle/polygon drawn with the ribbon's "as face" option on,
 *   which is the default) - it has a fill already, so this repaints that fill. Adding a
 *   second face on top would sit exactly coplanar with the first and z-fight with it.
 * - Closed wires/edges - nothing is filling the region yet, so a new `Face` is created to
 *   do it, and the boundary curves are left in place. That is AutoCAD's own model: a
 *   hatch is a fill laid over a boundary, not a replacement for it.
 */
@command({
    key: "create.hatch",
    icon: "icon-toFace",
})
export class HatchCommand extends CancelableCommand {
    @property("hatch.pattern", {
        combobox: Combobox.from(HatchPatterns.map((p) => p.display)),
    })
    get pattern(): I18nKeys {
        return this.getPrivateValue("pattern", HatchPatterns[0].display);
    }
    set pattern(value: I18nKeys) {
        this.setProperty("pattern", value);
    }

    @property("hatch.scale")
    get scale(): number {
        return this.getPrivateValue("scale", 1);
    }
    set scale(value: number) {
        this.setProperty("scale", value);
    }

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
        const hatchFace = curves.length > 0 ? this.faceFromCurves(curves) : undefined;
        if (curves.length > 0 && !hatchFace) {
            PubSub.default.pub("showToast", "toast.converter.error");
            return;
        }

        Transaction.execute(this.document, "hatch", () => {
            faces.forEach((x) => {
                x.materialId = this.createMaterial(x).id;
                // Without this the material is applied to a face nobody draws: a 2D
                // drawing is outlines by default, and `filled` is what opts a region
                // into being painted. See GeometryNode.filled.
                x.filled = true;
            });
            if (hatchFace) {
                hatchFace.materialId = this.createMaterial(hatchFace).id;
                hatchFace.filled = true;
                this.document.modelManager.rootNode.add(hatchFace);
            }
            this.document.visual.update();
            PubSub.default.pub("showToast", "toast.success");
        });
    }

    /** A face spanning the picked curves, or undefined if they do not bound a region. */
    private faceFromCurves(curves: ShapeNode[]): FaceNode | undefined {
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
     * The Material that paints `node` with the chosen pattern. One per hatched region
     * rather than one shared per pattern, because the tile count has to be worked out
     * from that region's own size - see textureRepeat.
     */
    private createMaterial(node: GeometryNode): Material {
        const def = HatchPatterns.find((x) => x.display === this.pattern) ?? HatchPatterns[0];
        const scale = this.scale > 0 ? this.scale : 1;

        const material = new Material({
            document: this.document,
            name: `${I18n.translate(def.display)} Hatch`,
            // The theme's own ink colour, as every other default-coloured thing uses. A
            // fixed dark grey vanishes against the dark theme's near-black viewport,
            // which reads as "the hatch did nothing".
            color: VisualConfig.defaultEdgeColor,
        });

        const texture = hatchPatternTexture(def.key);
        if (texture) {
            material.map.image = texture;
            material.map.repeat = this.textureRepeat(node, HATCH_BASE_TILE_SIZE * scale);
        }
        this.document.modelManager.materials.push(material);
        return material;
    }

    /**
     * How many times the pattern tile repeats across the region, so that one tile covers
     * `tile` drawing units of it.
     *
     * The mesher normalises every face's UVs to 0..1 over its own extent (see
     * `fillUv` in cpp/src/mesher.cpp), so a fixed repeat would stretch one tile across
     * the whole region no matter how big it is - a smear, not a pattern. The region's
     * bounding box converts that back into real units. Whole numbers keep the tile from
     * being cut mid-pattern where the texture wraps.
     */
    private textureRepeat(node: GeometryNode, tile: number): XY {
        const box = node.boundingBox();
        if (!box || tile <= 0) return new XY({ x: 1, y: 1 });

        // The two largest extents are the ones spanning the face; the third is its
        // thickness, which is zero for the planar faces this app draws.
        const [u, v] = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z].sort(
            (a, b) => b - a,
        );
        return new XY({ x: Math.max(1, Math.round(u / tile)), y: Math.max(1, Math.round(v / tile)) });
    }

    /**
     * A hatch boundary is anything that can bound a region: a face (already one), a closed
     * wire, or edges that join into one. Faces have to be in here - every shape the ribbon
     * draws with "as face" on, which is its default, is one, so leaving them out made HATCH
     * reject the rectangle a user had just drawn and selected.
     */
    private shapeFilter(): IShapeFilter {
        return {
            allow: (shape) =>
                shape.shapeType === ShapeTypes.edge ||
                shape.shapeType === ShapeTypes.wire ||
                shape.shapeType === ShapeTypes.face,
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
