import {
    type CollectionChangedArgs,
    I18n,
    type IDocument,
    type Layer,
    Localize,
    Transaction,
    type VisualNode,
} from "@chili3d/core";
import { div, label, option, select } from "@chili3d/element";
import commonStyle from "./common.module.css";
import { PropertyBase } from "./propertyBase";

const MULTI_VALUE = "";

/**
 * Which layer the selected objects are on, as the first row under General - the row an
 * AutoCAD user reaches for most, and until now the only way to change it was to make a
 * layer current and run MOVETOCURRENTLAYER.
 *
 * Layer membership is stored on the node as an id (see VisualNode.layerId) while the
 * dropdown is a list of names, so this maps between the two rather than binding
 * directly, and a layer renamed elsewhere shows its new name here without the node
 * being touched.
 */
export class LayerProperty extends PropertyBase {
    private readonly select: HTMLSelectElement;

    constructor(
        readonly document: IDocument,
        objects: VisualNode[],
    ) {
        super(objects);
        this.select = select({ className: commonStyle.select, onchange: this.setLayer });
        this.append(
            div(
                { className: commonStyle.panel },
                label({ className: commonStyle.propertyName, textContent: new Localize("common.layer") }),
                this.select,
            ),
        );
        this.refresh();
    }

    connectedCallback() {
        const manager = this.document.modelManager;
        manager.layers.onCollectionChanged(this.handleCollectionChanged);
        manager.layers.forEach((x) => x.onPropertyChanged(this.refresh));
        this.objects.forEach((x: VisualNode) => x.onPropertyChanged(this.handleNodeChanged));
    }

    disconnectedCallback() {
        const manager = this.document.modelManager;
        manager.layers.removeCollectionChanged(this.handleCollectionChanged);
        manager.layers.forEach((x) => x.removePropertyChanged(this.refresh));
        this.objects.forEach((x: VisualNode) => x.removePropertyChanged(this.handleNodeChanged));
    }

    // Renaming a layer changes what this row reads without changing what it points at,
    // so the list follows individual layers as well as the collection they live in.
    private readonly handleCollectionChanged = (args: CollectionChangedArgs) => {
        if (args.action === "add") {
            args.items.forEach((x: Layer) => x.onPropertyChanged(this.refresh));
        } else if (args.action === "remove") {
            args.items.forEach((x: Layer) => x.removePropertyChanged(this.refresh));
        }
        this.refresh();
    };

    private readonly handleNodeChanged = (property: keyof VisualNode) => {
        if (property === "layerId") this.refresh();
    };

    private readonly refresh = () => {
        const current = this.currentValue();
        const options = this.document.modelManager.layers.map((layer) =>
            option({ value: layer.id, textContent: layer.name, selected: layer.id === current }),
        );
        if (current === MULTI_VALUE) {
            options.unshift(
                option({
                    value: MULTI_VALUE,
                    textContent: I18n.translate("properties.multivalue"),
                    selected: true,
                    hidden: true,
                }),
            );
        }
        this.select.replaceChildren(...options);
    };

    /** The layer shared by the whole selection, or "" when they are on different ones. */
    private currentValue(): string {
        const ids = new Set(this.objects.map((x: VisualNode) => x.layerId));
        return ids.size === 1 ? ids.values().next().value! : MULTI_VALUE;
    }

    private readonly setLayer = (e: Event) => {
        const layerId = (e.target as HTMLSelectElement).value;
        if (layerId === MULTI_VALUE) return;

        Transaction.execute(this.document, "change layer", () => {
            this.objects.forEach((x: VisualNode) => {
                x.layerId = layerId;
            });
        });
        // The new layer's colour, on/off state and lock have to be resolved onto the
        // objects that just moved onto it - the same step MOVETOCURRENTLAYER takes.
        this.document.visual.context.refreshLayerStyling();
        this.document.visual.update();
    };
}

customElements.define("chili-layer-property", LayerProperty);
