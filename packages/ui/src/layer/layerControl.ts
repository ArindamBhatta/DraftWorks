// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    I18n,
    type IDocument,
    type INode,
    type IView,
    type Layer,
    Localize,
    PubSub,
    VisualNode,
} from "@draftworks/core";
import { div, input, span, svg } from "@draftworks/element";
import { DropdownController } from "../ribbon/dropdownController";
import style from "./layerControl.module.css";

/**
 * Which layer id a selection reports, by AutoCAD's rule: the shared layer when every
 * selected object is on one, and `undefined` when the selection spans several, because
 * the control has a single row and no honest way to put two names in it. An empty
 * selection also reports `undefined` - the caller then falls back to the current layer.
 *
 * Only VisualNode carries a layer, so anything else in the selection (a folder, say)
 * has no layer to contribute and is skipped rather than counted as a second one.
 */
export function selectedLayerId(nodes: readonly INode[]): string | undefined {
    let found: string | undefined;
    for (const node of nodes) {
        if (!(node instanceof VisualNode)) continue;
        if (found === undefined) found = node.layerId;
        else if (found !== node.layerId) return undefined;
    }
    return found;
}

/**
 * AutoCAD's Layer control - the combo that sits in the ribbon's Layers panel.
 *
 * Closed, it is a readout of the current layer: its on/off bulb, its lock, its colour
 * and its name. Those are live, not decoration - clicking the bulb switches the current
 * layer off from here, which is the whole point of the control being in the ribbon
 * rather than in the Layer Properties Manager two clicks away. Opening it lists every
 * layer with the same three toggles, and picking a row makes that layer current, so the
 * next object drawn lands there.
 *
 * With objects selected it stops reading the current layer and reports the selection's
 * layer instead, exactly as AutoCAD's does: one object (or several sharing a layer)
 * shows that layer, and a selection spanning several layers shows nothing at all,
 * because the control has one row to say it in. Picking a layer while a selection is
 * live is still only "make this current" here - AutoCAD also reassigns the selected
 * objects, which MOVETOLAYER already does as its own command.
 *
 * Takes no document: the ribbon is built once at start-up, before any document exists,
 * so this follows the active one the way ProjectView does.
 */
export class LayerControl extends HTMLElement {
    private _document: IDocument | undefined;
    /** The current selection, as `showProperties` last reported it. */
    private _selected: INode[] = [];
    private readonly face: HTMLElement;
    private readonly dropdown = new DropdownController(style.dropdown);

    constructor() {
        super();
        this.className = style.control;
        this.face = div({ className: style.face });
        this.append(this.face);

        PubSub.default.sub("activeViewChanged", this.handleActiveViewChanged);
        // Every selection change publishes this, including deselection to an empty array.
        PubSub.default.sub("showProperties", this.handleSelectionChanged);
    }

    connectedCallback() {
        this.refresh();
    }

    disconnectedCallback() {
        PubSub.default.remove("activeViewChanged", this.handleActiveViewChanged);
        PubSub.default.remove("showProperties", this.handleSelectionChanged);
        this.unsubscribe();
        this.dropdown.dispose();
    }

    private readonly handleActiveViewChanged = (view: IView | undefined) => {
        this.setDocument(view?.document);
    };

    private setDocument(document: IDocument | undefined) {
        if (this._document === document) return;

        this.unsubscribe();
        this._document = document;
        this.subscribe();
        this.refresh();
    }

    private subscribe() {
        const manager = this._document?.modelManager;
        if (!manager) return;
        manager.layers.onCollectionChanged(this.refresh);
        manager.onPropertyChanged(this.handleManagerChanged);
        manager.layers.forEach((x) => x.onPropertyChanged(this.refresh));
    }

    private unsubscribe() {
        const manager = this._document?.modelManager;
        if (!manager) return;
        manager.layers.removeCollectionChanged(this.refresh);
        manager.removePropertyChanged(this.handleManagerChanged);
        manager.layers.forEach((x) => x.removePropertyChanged(this.refresh));
    }

    private readonly handleManagerChanged = (property: string) => {
        if (property === "currentLayerId") this.refresh();
    };

    private readonly handleSelectionChanged = (document: IDocument, nodes: INode[]) => {
        // A stale selection from a document that is no longer active would otherwise
        // keep overriding this one's current layer.
        if (document !== this._document) return;
        this._selected = nodes;
        this.refresh();
    };

    /**
     * Which layer the closed control reports, following AutoCAD: the selection's own
     * layer when there is a selection, and the current layer only when there is not.
     * `undefined` means the selection spans more than one layer, which the control
     * shows as blank - there is one row and no honest way to put two names in it.
     */
    private displayedLayer(): Layer | undefined {
        const manager = this._document!.modelManager;
        const hasSelection = this._selected.some((node) => node instanceof VisualNode);
        if (!hasSelection) return manager.currentLayer;

        const id = selectedLayerId(this._selected);
        if (id === undefined) return undefined;

        // A layer deleted while its objects were selected leaves an id that no longer
        // resolves; falling back to the current layer beats rendering nothing.
        return manager.layers.find((layer) => layer.id === id) ?? manager.currentLayer;
    }

    private readonly refresh = () => {
        const manager = this._document?.modelManager;
        if (!manager) {
            // No drawing open yet - show the control inert rather than empty, so the
            // panel does not visibly reflow the moment a document appears.
            this.face.replaceChildren(span({ className: style.name, textContent: "" }));
            return;
        }

        // Layers added since the last pass need their own subscription; removing first
        // keeps this idempotent for the ones already wired up.
        manager.layers.forEach((layer) => {
            layer.removePropertyChanged(this.refresh);
            layer.onPropertyChanged(this.refresh);
        });

        const arrow = div({
            className: style.arrow,
            onclick: (e) => {
                e.stopPropagation();
                this.toggleDropdown();
            },
        });

        const displayed = this.displayedLayer();
        if (!displayed) {
            // Selection spans several layers. The toggles and the swatch go with the
            // name: they act on one layer, and there is no single layer to act on.
            this.face.replaceChildren(span({ className: style.name, textContent: "" }), arrow);
            return;
        }

        this.face.replaceChildren(
            this.visibleToggle(displayed),
            this.freezeToggle(displayed),
            this.lockToggle(displayed),
            this.colorSwatch(displayed),
            span({ className: style.name, title: displayed.name, textContent: displayed.name }),
            arrow,
        );
    };

    private visibleToggle(layer: Layer) {
        return svg({
            icon: layer.visible ? "icon-eye" : "icon-ban",
            className: style.toggle,
            title: new Localize("layer.toggleOn"),
            onclick: (e) => {
                e.stopPropagation();
                layer.visible = !layer.visible;
            },
        });
    }

    /**
     * AutoCAD's combo carries freeze between the bulb and the padlock, so all three of
     * the ways a layer can be taken out of the way sit together.
     */
    private freezeToggle(layer: Layer) {
        return svg({
            icon: layer.frozen ? "icon-freeze" : "icon-thaw",
            className: style.toggle,
            title: new Localize("layer.toggleFreeze"),
            onclick: (e) => {
                e.stopPropagation();
                layer.frozen = !layer.frozen;
            },
        });
    }

    private lockToggle(layer: Layer) {
        return svg({
            icon: layer.locked ? "icon-lock" : "icon-unlock",
            className: style.toggle,
            title: new Localize("layer.toggleLock"),
            onclick: (e) => {
                e.stopPropagation();
                layer.locked = !layer.locked;
            },
        });
    }

    private colorSwatch(layer: Layer) {
        const hex = `#${layer.color.toString(16).padStart(6, "0")}`;
        const picker = input({
            type: "color",
            value: layer.usesThemeColor ? "#ffffff" : hex,
            className: `${style.swatch} ${layer.usesThemeColor ? style.themeSwatch : ""}`,
            title: I18n.translate("layer.color"),
            onclick: (e) => e.stopPropagation(),
            oninput: (e) => {
                layer.color = Number.parseInt((e.target as HTMLInputElement).value.slice(1), 16);
            },
        });
        if (!layer.usesThemeColor) picker.style.backgroundColor = hex;
        return picker;
    }

    private toggleDropdown() {
        if (this.dropdown.isOpened) {
            this.dropdown.close();
            return;
        }

        const manager = this._document?.modelManager;
        if (!manager) return;

        this.dropdown.open(this.face, (container) => {
            manager.layers.forEach((layer) => {
                container.append(this.layerRow(layer, layer.id === manager.currentLayerId));
            });
        });
    }

    private layerRow(layer: Layer, isCurrent: boolean) {
        return div(
            {
                className: [style.row, isCurrent ? style.current : ""].filter(Boolean).join(" "),
                title: I18n.translate("layer.setCurrentTip"),
                onclick: () => {
                    const manager = this._document?.modelManager;
                    if (manager) manager.currentLayerId = layer.id;
                    this.dropdown.close();
                },
            },
            this.visibleToggle(layer),
            this.freezeToggle(layer),
            this.lockToggle(layer),
            this.colorSwatch(layer),
            span({ className: style.name, title: layer.name, textContent: layer.name }),
        );
    }
}

customElements.define("chili-layer-control", LayerControl);
