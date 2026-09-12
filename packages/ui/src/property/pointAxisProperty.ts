import {
    I18n,
    type I18nKeys,
    type IDocument,
    type Property,
    PubSub,
    Transaction,
    UnitSetup,
    type VisualNode,
    XYZ,
} from "@draftworks/core";
import { div, input, label } from "@draftworks/element";
import commonStyle from "./common.module.css";
import style from "./input.module.css";
import { PropertyBase } from "./propertyBase";

export type Axis = "x" | "y" | "z";

export const AXES: readonly Axis[] = ["x", "y", "z"];

const AXIS_LABELS: Record<Axis, I18nKeys> = {
    x: "geometry.axis.x",
    y: "geometry.axis.y",
    z: "geometry.axis.z",
};

/**
 * One coordinate of a point property, on its own row: AutoCAD's Start X, Start Y,
 * Start Z rather than a single "1, 2, 3" field. Splitting them is not only how the
 * palette looks - it is how it is used, since nudging one coordinate is the common
 * edit and retyping all three to do it is a good way to move an object twice.
 *
 * Two things this reads and writes differ from the stored property:
 *
 * - **World, not local.** MOVE and ROTATE leave a body's own parameters alone and
 *   accumulate into its transform (see TransformedCommand), so a moved line still
 *   stores the start point it was drawn at. Showing that raw value means the palette
 *   disagrees with the crosshair readout for anything that was ever moved, so the
 *   value shown is put through the node's world transform and typed values are put
 *   back through its inverse.
 * - **Drawing units, not raw numbers.** The text goes through the same formatter and
 *   parser as every other length in the app, so a drawing set to architectural units
 *   shows 5'-8 1/2" here and accepts it back.
 */
export class PointAxisProperty extends PropertyBase {
    private readonly input: HTMLInputElement;

    constructor(
        readonly document: IDocument,
        objects: VisualNode[],
        readonly property: Property,
        readonly axis: Axis,
    ) {
        super(objects);
        this.input = input({
            className: style.box,
            onkeydown: this.handleKeyDown,
            onblur: this.handleBlur,
        });
        this.append(
            div(
                { className: commonStyle.panel },
                label({
                    className: commonStyle.propertyName,
                    textContent: `${I18n.translate(property.display)} ${I18n.translate(AXIS_LABELS[axis])}`,
                }),
                this.input,
            ),
        );
        this.refresh();
    }

    connectedCallback() {
        this.objects.forEach((x: VisualNode) => x.onPropertyChanged(this.handlePropertyChanged));
    }

    disconnectedCallback() {
        this.objects.forEach((x: VisualNode) => x.removePropertyChanged(this.handlePropertyChanged));
    }

    // The transform matters as much as the point itself here: a MOVE changes where this
    // row says the endpoint is without touching the property it is named after.
    private readonly handlePropertyChanged = (property: keyof VisualNode) => {
        if (property === this.property.name || property === "transform") {
            this.refresh();
        }
    };

    private refresh() {
        // Never overwrite what the user is halfway through typing - editing Start X
        // republishes the shape, which comes straight back here as a change to refresh.
        if (this.input === this.ownerDocument.activeElement) return;

        const texts = new Set(
            this.objects.map((x: VisualNode) => UnitSetup.formatLength(this.worldValue(x))),
        );
        const shared = texts.size === 1;
        this.input.value = shared ? texts.values().next().value! : "";
        this.input.placeholder = shared ? "" : I18n.translate("properties.multivalue");
    }

    private worldValue(node: VisualNode): number {
        const point = (node as any)[this.property.name] as XYZ;
        return node.worldTransform().ofPoint(point)[this.axis];
    }

    private readonly handleBlur = () => this.commit();

    private readonly handleKeyDown = (e: KeyboardEvent) => {
        // The viewport listens for keystrokes too - a typed "e" is ERASE out there.
        e.stopPropagation();
        if (e.key === "Enter") {
            this.input.blur();
        } else if (e.key === "Escape") {
            this.refresh();
            this.input.blur();
        }
    };

    private commit() {
        const text = this.input.value.trim();
        if (text === "") {
            this.refresh();
            return;
        }

        const value = UnitSetup.tryParseLength(text);
        if (value === undefined) {
            PubSub.default.pub("showToast", "error.default:{0}", text);
            this.refresh();
            return;
        }

        Transaction.execute(this.document, "modify property", () => {
            this.objects.forEach((node: VisualNode) => this.moveTo(node, value));
            this.document.visual.update();
        });
        this.refresh();
    }

    /** Puts the typed world coordinate back into whatever frame this node stores. */
    private moveTo(node: VisualNode, value: number) {
        const world = node.worldTransform();
        const point = world.ofPoint((node as any)[this.property.name] as XYZ);
        const moved = new XYZ({
            x: this.axis === "x" ? value : point.x,
            y: this.axis === "y" ? value : point.y,
            z: this.axis === "z" ? value : point.z,
        });
        // A transform with no inverse has collapsed the node to zero size, so there is
        // no frame to map back into - write the world point and let it stand.
        const inverse = world.invert();
        (node as any)[this.property.name] = inverse ? inverse.ofPoint(moved) : moved;
    }
}

customElements.define("chili-point-axis-property", PointAxisProperty);
