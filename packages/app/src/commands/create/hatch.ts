import {
    Combobox,
    command,
    type GeometryNode,
    I18n,
    type I18nKeys,
    Material,
    property,
    VisualConfig,
    XY,
} from "@draftworks/core";
import { FillCommand } from "./fillCommand";
import { HATCH_BASE_TILE_SIZE, HatchPatterns, hatchPatternTexture } from "./hatchPatterns";

/**
 * AutoCAD's HATCH (H/BH): pick a pattern, pick (or use the current selection of) a closed
 * region, and it fills it. The fill is a `Material` whose texture is a generated pattern
 * tile (see hatchPatterns.ts); "Solid" is the one exception, needing no texture at all,
 * since an untextured Material already is a solid fill.
 *
 * How a boundary is picked and turned into something paintable is FillCommand's job -
 * GRADIENT answers those questions identically and differs only below, in what the
 * region is painted with.
 */
@command({
    key: "create.hatch",
    icon: "icon-toFace",
})
export class HatchCommand extends FillCommand {
    protected override get fillName(): string {
        return "hatch";
    }

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

    /**
     * The Material that paints `node` with the chosen pattern. One per hatched region
     * rather than one shared per pattern, because the tile count has to be worked out
     * from that region's own size - see textureRepeat.
     */
    protected override createMaterial(node: GeometryNode): Material {
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
}
