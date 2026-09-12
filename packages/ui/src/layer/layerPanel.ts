// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    I18n,
    type I18nKeys,
    type IDocument,
    type IView,
    LAYER_LINE_WEIGHTS,
    type Layer,
    type LineType,
    Localize,
    MAX_LAYER_TRANSPARENCY,
    PubSub,
    Transaction,
    VisualNode,
} from "@draftworks/core";
import { div, input, span, svg } from "@draftworks/element";
import style from "./layerPanel.module.css";

/**
 * AutoCAD's Layer Properties Manager. Each row carries the full column set - status,
 * on/off, freeze, lock, colour, linetype, lineweight, transparency and plot - and
 * clicking the row makes that layer current. Opened by the LAYER command (LA) as a
 * floating palette - see layerFloatPanel.ts.
 *
 * Every column is a glyph rather than a label, so a row stays readable at a glance and
 * the panel stays narrow. That leaves the three columns which are values rather than
 * states - linetype, lineweight, transparency - without anywhere to put a menu, so they
 * are drawn as a preview of what they do (the actual dash pattern, the actual thickness,
 * the actual fade) and cycle through the available settings on click.
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
        const count = this.objectCount(layer);
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
            this.statusGlyph(layer, isCurrent, count),
            this.toggle(layer, "visible", "layer.toggleOn", "icon-eye", "icon-ban"),
            this.toggle(layer, "frozen", "layer.toggleFreeze", "icon-freeze", "icon-thaw"),
            this.toggle(layer, "locked", "layer.toggleLock", "icon-lock", "icon-unlock"),
            this.colorSwatch(layer),
            this.lineTypePreview(layer),
            this.lineWeightPreview(layer),
            this.transparencyPreview(layer),
            this.toggle(layer, "printable", "layer.togglePlot", "icon-plot", "icon-noplot"),
            nameBox,
            span({ className: style.count, textContent: String(count) }),
        );
    }

    /**
     * A boolean column. The `on` icon is shown when the property is true, except for
     * lock and freeze where "true" is the closed/frozen state - so the caller passes
     * whichever pair reads correctly for that column.
     */
    private toggle(
        layer: Layer,
        property: "visible" | "frozen" | "locked" | "printable",
        title: I18nKeys,
        whenTrue: string,
        whenFalse: string,
    ) {
        return svg({
            icon: layer[property] ? whenTrue : whenFalse,
            className: style.toggle,
            title: new Localize(title),
            onclick: (e) => {
                e.stopPropagation();
                layer[property] = !layer[property];
            },
        });
    }

    /**
     * AutoCAD's Status column: which layer is current, which have objects on them, and
     * which are empty - the cue for what is safe to delete.
     */
    private statusGlyph(layer: Layer, isCurrent: boolean, count: number) {
        if (isCurrent) {
            return svg({
                icon: "icon-check",
                className: `${style.toggle} ${style.statusCurrent}`,
                title: new Localize("layer.status.current"),
            });
        }
        return svg({
            icon: "icon-layer-group",
            className: `${style.toggle} ${count > 0 ? style.statusInUse : style.statusEmpty}`,
            title: new Localize(count > 0 ? "layer.status.inUse" : "layer.status.empty"),
        });
    }

    /**
     * A line drawn to show what a setting does. A tooltip on an SVG is a <title> child,
     * not a title attribute - the attribute is inert here.
     */
    private linePreview(width: number, dashArray: string, tip: I18nKeys, onClick: () => void) {
        const ns = "http://www.w3.org/2000/svg";
        const preview = document.createElementNS(ns, "svg");
        preview.setAttribute("viewBox", "0 0 24 12");
        preview.classList.add(style.preview);

        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", "1");
        line.setAttribute("y1", "6");
        line.setAttribute("x2", "23");
        line.setAttribute("y2", "6");
        line.setAttribute("stroke", "currentColor");
        line.setAttribute("stroke-width", String(width));
        if (dashArray) line.setAttribute("stroke-dasharray", dashArray);

        const title = document.createElementNS(ns, "title");
        title.textContent = I18n.translate(tip);

        preview.append(title, line);
        preview.onclick = (e) => {
            e.stopPropagation();
            onClick();
        };
        return preview;
    }

    /** The linetype drawn as itself: a short line in that dash pattern. */
    private lineTypePreview(layer: Layer) {
        const order: LineType[] = ["solid", "dash", "hidden", "dot"];
        const dashes: Record<string, string> = { solid: "", dash: "6 4", hidden: "3 3", dot: "1 3" };

        return this.linePreview(1.5, dashes[layer.lineType] ?? "", "layer.lineType", () => {
            layer.lineType = order[(order.indexOf(layer.lineType) + 1) % order.length];
        });
    }

    /** The lineweight drawn as itself: a line of that thickness. */
    private lineWeightPreview(layer: Layer) {
        return this.linePreview(layer.lineWeight, "", "layer.lineWeight", () => {
            const index = LAYER_LINE_WEIGHTS.indexOf(layer.lineWeight);
            layer.lineWeight = LAYER_LINE_WEIGHTS[(index + 1) % LAYER_LINE_WEIGHTS.length];
        });
    }

    /** Transparency drawn as itself: the layer colour faded by that much. */
    private transparencyPreview(layer: Layer) {
        const step = 30;
        const swatch = div({
            className: style.transparency,
            title: I18n.translate("layer.transparency"),
            onclick: (e) => {
                e.stopPropagation();
                const next = layer.transparency + step;
                layer.transparency = next > MAX_LAYER_TRANSPARENCY ? 0 : next;
            },
        });
        swatch.style.opacity = String(1 - layer.transparency / 100);
        return swatch;
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
