// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    I18n,
    type IDocument,
    type IView,
    type Layer,
    Localize,
    PubSub,
    Transaction,
    VisualNode,
} from "@chili3d/core";
import { div, input, span, svg } from "@chili3d/element";
import style from "./layerPanel.module.css";

/**
 * AutoCAD's Layer Properties Manager: each row is on/off, lock, colour swatch, name,
 * object count, and clicking the row makes that layer current. Opened by the LAYER
 * command (LA) as a floating palette - see layerFloatPanel.ts.
 */
export class LayerPanel extends HTMLElement {
    private _document: IDocument | undefined;
    private readonly list: HTMLDivElement;

    // Takes the document up front rather than waiting on activeViewChanged, because that
    // event fires once when a document becomes active and this panel is normally opened
    // well after that - by the LAYER command, on a document that is already showing. A
    // subscriber that only started listening after the fact would sit empty forever.
    constructor(document: IDocument, props?: { className?: string }) {
        super();
        this.classList.add(style.root);
        if (props?.className) this.classList.add(props.className);
        this.list = div({ className: style.list });
        this.render();

        PubSub.default.sub("activeViewChanged", this.handleActiveViewChanged);
        this.setDocument(document);
    }

    private render() {
        this.append(
            div(
                { className: style.headerPanel },
                span({ className: style.header, textContent: new Localize("layer.header") }),
                div(
                    { className: style.tools },
                    svg({
                        icon: "icon-plus",
                        title: new Localize("layer.new"),
                        onclick: () => this.addLayer(),
                    }),
                    svg({
                        icon: "icon-trash",
                        title: new Localize("layer.delete"),
                        onclick: () => this.deleteCurrentLayer(),
                    }),
                ),
            ),
            this.list,
        );
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
        manager.layers.forEach((x) => {
            x.onPropertyChanged(this.refresh);
        });
    }

    private unsubscribe() {
        const manager = this._document?.modelManager;
        if (!manager) return;
        manager.layers.removeCollectionChanged(this.refresh);
        manager.removePropertyChanged(this.handleManagerChanged);
        manager.layers.forEach((x) => {
            x.removePropertyChanged(this.refresh);
        });
    }

    private readonly handleManagerChanged = (property: string) => {
        if (property === "currentLayerId") this.refresh();
    };

    private readonly refresh = () => {
        const manager = this._document?.modelManager;
        this.list.replaceChildren();
        if (!manager) return;

        // Re-subscribing on every refresh keeps rows live for layers added since the
        // last pass; removePropertyChanged is a no-op for handlers already attached.
        manager.layers.forEach((layer) => {
            layer.removePropertyChanged(this.refresh);
            layer.onPropertyChanged(this.refresh);
            this.list.append(this.layerRow(layer, manager.currentLayerId === layer.id));
        });
    };

    private layerRow(layer: Layer, isCurrent: boolean) {
        const nameBox = input({
            className: style.name,
            value: layer.name,
            readOnly: layer.isDefault,
            title: layer.name,
            onkeydown: (e) => {
                e.stopPropagation();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            },
            onclick: (e) => e.stopPropagation(),
            onchange: (e) => this.renameLayer(layer, (e.target as HTMLInputElement).value),
        });

        return div(
            {
                className: [style.row, isCurrent ? style.current : "", layer.visible ? "" : style.off]
                    .filter(Boolean)
                    .join(" "),
                title: I18n.translate("layer.setCurrentTip"),
                onclick: () => this.setCurrent(layer),
            },
            svg({
                icon: layer.visible ? "icon-eye" : "icon-ban",
                title: new Localize("layer.toggleOn"),
                onclick: (e) => {
                    e.stopPropagation();
                    layer.visible = !layer.visible;
                },
            }),
            svg({
                icon: layer.locked ? "icon-lock" : "icon-unlock",
                title: new Localize("layer.toggleLock"),
                onclick: (e) => {
                    e.stopPropagation();
                    layer.locked = !layer.locked;
                },
            }),
            this.colorSwatch(layer),
            nameBox,
            span({ className: style.count, textContent: String(this.objectCount(layer)) }),
        );
    }

    private colorSwatch(layer: Layer) {
        const picker = input({
            type: "color",
            value: layer.usesThemeColor ? "#ffffff" : `#${layer.color.toString(16).padStart(6, "0")}`,
            className: `${style.swatch} ${layer.usesThemeColor ? style.themeSwatch : ""}`,
            title: I18n.translate("layer.color"),
            onclick: (e) => e.stopPropagation(),
            oninput: (e) => {
                layer.color = Number.parseInt((e.target as HTMLInputElement).value.slice(1), 16);
            },
        });
        if (!layer.usesThemeColor) {
            picker.style.backgroundColor = `#${layer.color.toString(16).padStart(6, "0")}`;
        }
        return picker;
    }

    private objectCount(layer: Layer) {
        const manager = this._document?.modelManager;
        if (!manager) return 0;
        return manager.findNodes((node) => node instanceof VisualNode && node.layerId === layer.id).length;
    }

    private setCurrent(layer: Layer) {
        const manager = this._document?.modelManager;
        if (manager) manager.currentLayerId = layer.id;
    }

    private renameLayer(layer: Layer, value: string) {
        const manager = this._document?.modelManager;
        const name = value.trim();
        if (!manager || !name || name === layer.name) {
            this.refresh();
            return;
        }
        if (manager.layers.find((x) => x !== layer && x.name === name)) {
            PubSub.default.pub("showToast", "layer.error.duplicateName");
            this.refresh();
            return;
        }
        layer.name = name;
    }

    private addLayer() {
        const document = this._document;
        if (!document) return;

        const manager = document.modelManager;
        Transaction.execute(document, "add layer", () => {
            manager.currentLayerId = manager.addLayer().id;
        });
    }

    private deleteCurrentLayer() {
        const document = this._document;
        if (!document) return;

        const manager = document.modelManager;
        const layer = manager.currentLayer;
        const check = manager.canRemoveLayer(layer);
        if (!check.ok) {
            PubSub.default.pub(
                "showToast",
                check.reason === "default" ? "layer.error.deleteDefault" : "layer.error.deleteInUse",
            );
            return;
        }
        Transaction.execute(document, "delete layer", () => {
            manager.removeLayer(layer);
        });
    }

    connectedCallback() {
        this.setDocument(this._document ?? undefined);
        this.refresh();
    }

    disconnectedCallback() {
        PubSub.default.remove("activeViewChanged", this.handleActiveViewChanged);
        this.unsubscribe();
    }
}

customElements.define("chili-layer-panel", LayerPanel);
