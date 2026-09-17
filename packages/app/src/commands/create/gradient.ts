import {
    Combobox,
    command,
    type GeometryNode,
    I18n,
    type I18nKeys,
    Material,
    property,
} from "@draftworks/core";
import { FillCommand } from "./fillCommand";
import { GradientStyles, gradientTexture } from "./gradientPatterns";

/**
 * AutoCAD's GRADIENT (GD): the same boundary question HATCH asks, answered with a smooth
 * two-colour ramp instead of a pattern. Everything about picking the region is
 * FillCommand's; this only decides what paints it.
 */
@command({
    key: "create.gradient",
    icon: "icon-toFace",
})
export class GradientCommand extends FillCommand {
    protected override get fillName(): string {
        return "gradient";
    }

    @property("gradient.style", {
        combobox: Combobox.from(GradientStyles.map((s) => s.display)),
    })
    get style(): I18nKeys {
        return this.getPrivateValue("style", GradientStyles[0].display);
    }
    set style(value: I18nKeys) {
        this.setProperty("style", value);
    }

    @property("gradient.color1", { type: "color" })
    get color1(): string {
        return this.getPrivateValue("color1", "#3f7fbf");
    }
    set color1(value: string) {
        this.setProperty("color1", value);
    }

    @property("gradient.color2", { type: "color" })
    get color2(): string {
        return this.getPrivateValue("color2", "#ffffff");
    }
    set color2(value: string) {
        this.setProperty("color2", value);
    }

    /**
     * Only a linear ramp has a direction to be asked about - a radial one runs out from
     * the middle whichever way you turn it - so the setting goes away rather than sitting
     * there doing nothing. See Property.dependencies.
     */
    @property("gradient.angle", {
        dependencies: [{ property: "style", value: "gradient.style.linear" }],
    })
    get angle(): number {
        return this.getPrivateValue("angle", 0);
    }
    set angle(value: number) {
        this.setProperty("angle", value);
    }

    protected override createMaterial(_node: GeometryNode): Material {
        const def = GradientStyles.find((x) => x.display === this.style) ?? GradientStyles[0];
        const material = new Material({
            document: this.document,
            name: `${I18n.translate(def.display)} Gradient`,
            // White, and unlit below: the ramp in the texture is the fill's colour, so
            // the material must neither tint it (a coloured base multiplies into every
            // texel) nor shade it (the viewport's lights would wash a mid-tone out).
            color: 0xffffff,
        });
        material.unlit = true;
        material.map.image = gradientTexture(
            def.key,
            this.color1,
            this.color2,
            Number.isFinite(this.angle) ? this.angle : 0,
        );
        // Left at the default 1x1 repeat, unlike a hatch tile: the mesher normalises a
        // face's UVs over its own extent, so one copy of the ramp already spans exactly
        // the region being filled, however big it is.
        this.document.modelManager.materials.push(material);
        return material;
    }
}
