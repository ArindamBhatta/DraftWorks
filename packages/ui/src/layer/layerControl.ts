// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type IDocument, type IView, type Layer, Localize, PubSub } from "@chili3d/core";
import { div, input, span, svg } from "@chili3d/element";
import { DropdownController } from "../ribbon/dropdownController";
import style from "./layerControl.module.css";

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
 * Takes no document: the ribbon is built once at start-up, before any document exists,
 * so this follows the active one the way ProjectView does.
 */
export class LayerControl extends HTMLElement {
    private _document: IDocument | undefined;
    private readonly face: HTMLElement;
    private readonly dropdown = new DropdownController(style.dropdown);

    constructor() {
        super();
        this.className = style.control;
        this.face = div({ className: style.face });
        this.append(this.face);

        PubSub.default.sub("activeViewChanged", this.handleActiveViewChanged);
    }

    connectedCallback() {
        this.refresh();
    }

    disconnectedCallback() {
        PubSub.default.remove("activeViewChanged", this.handleActiveViewChanged);
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

        const current = manager.currentLayer;
        this.face.replaceChildren(
            this.visibleToggle(current),
            this.lockToggle(current),
            this.colorSwatch(current),
            span({ className: style.name, title: current.name, textContent: current.name }),
            div({
                className: style.arrow,
                onclick: (e) => {
                    e.stopPropagation();
                    this.toggleDropdown();
                },
            }),
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
            this.lockToggle(layer),
            this.colorSwatch(layer),
            span({ className: style.name, title: layer.name, textContent: layer.name }),
        );
    }
}

customElements.define("chili-layer-control", LayerControl);
