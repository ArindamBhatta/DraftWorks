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
import { DropdownController } from "../ribbon/dropdownController";
import style from "./layerPanel.module.css";

/** The dash patterns each linetype draws with, shared by the preview and the picker. */
const LINE_TYPE_DASHES: Record<LineType, string> = {
    byLayer: "",
    solid: "",
    dash: "6 4",
    hidden: "3 3",
    dot: "1 3",
};

/** In AutoCAD's dropdown order: Continuous first, then the patterns. "byLayer" is
 *  absent because a layer cannot defer to itself - it is what the others defer to. */
const LINE_TYPES: { value: LineType; display: I18nKeys }[] = [
    { value: "solid", display: "lineType.solid" },
    { value: "dash", display: "lineType.dash" },
    { value: "hidden", display: "lineType.hidden" },
    { value: "dot", display: "lineType.dot" },
];

const TRANSPARENCY_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];

/**
 * AutoCAD's Layer Properties Manager. Each row carries the full column set - status,
 * on/off, freeze, lock, colour, linetype, lineweight, transparency and plot - and
 * clicking the row makes that layer current. Opened by the LAYER command (LA) as a
 * floating palette - see layerFloatPanel.ts.
 *
 * Every column is a glyph rather than a label, so a row stays readable at a glance and
 * the panel stays narrow. The three columns which are values rather than states -
 * linetype, lineweight, transparency - still draw themselves (the actual dash pattern,
 * the actual thickness, the actual fade), but clicking one opens a picker listing every
 * setting, the way AutoCAD 2013 does. They used to cycle to the next value per click,
 * which made choosing one a guessing game: to see a pattern you had to select it, and to
 * compare two you had to walk the whole list around again.
 */
export class LayerPanel extends HTMLElement {
    private _document: IDocument | undefined;
    private readonly list: HTMLDivElement;
    /** Set while a colour picker is open - see colorSwatch for why refresh must wait. */
    private suppressRefresh = false;

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
        // A live colour picker is a child of the row this would destroy, so rebuilding
        // now would shut it mid-drag. colorSwatch refreshes once the picker closes.
        if (this.suppressRefresh) return;

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
     * not a title attribute - the attribute is inert here. The caller attaches the click
     * that opens the picker, since only it knows which values are on offer.
     */
    private linePreview(width: number, dashArray: string, tip: I18nKeys) {
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
        return preview;
    }

    /**
     * Opens a picker under the swatch that was clicked. Each entry previews the value it
     * sets and is labelled with it, so the list can be read and compared without anything
     * being applied - picking is what applies it.
     *
     * The dropdown is appended to document.body rather than to the row, because the row
     * is replaced wholesale on every refresh and the list is scroll-clipped; a menu
     * parented inside either would vanish or be cut off.
     */
    private openPicker<T>(
        anchor: Element,
        options: { value: T; label: string; preview: () => Element }[],
        current: T,
        apply: (value: T) => void,
    ) {
        const dropdown = new DropdownController(style.picker);
        dropdown.open(anchor, (menu) => {
            options.forEach((entry) => {
                const row = div(
                    {
                        className: `${style.pickerItem} ${entry.value === current ? style.pickerCurrent : ""}`,
                        onclick: (e) => {
                            e.stopPropagation();
                            apply(entry.value);
                            dropdown.close();
                        },
                    },
                    entry.preview(),
                    span({ className: style.pickerLabel, textContent: entry.label }),
                );
                menu.append(row);
            });
        });
    }

    /** A line drawn at a given width and dash pattern, for use inside a picker row. */
    private sampleLine(width: number, dashArray: string) {
        const ns = "http://www.w3.org/2000/svg";
        const sample = document.createElementNS(ns, "svg");
        sample.setAttribute("viewBox", "0 0 48 12");
        sample.classList.add(style.pickerPreview);

        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", "1");
        line.setAttribute("y1", "6");
        line.setAttribute("x2", "47");
        line.setAttribute("y2", "6");
        line.setAttribute("stroke", "currentColor");
        line.setAttribute("stroke-width", String(width));
        if (dashArray) line.setAttribute("stroke-dasharray", dashArray);

        sample.append(line);
        return sample;
    }

    /** The linetype drawn as itself: a short line in that dash pattern. */
    private lineTypePreview(layer: Layer) {
        const swatch = this.linePreview(1.5, LINE_TYPE_DASHES[layer.lineType] ?? "", "layer.lineType");
        swatch.onclick = (e) => {
            e.stopPropagation();
            this.openPicker(
                swatch,
                LINE_TYPES.map((x) => ({
                    value: x.value,
                    label: I18n.translate(x.display),
                    preview: () => this.sampleLine(1.5, LINE_TYPE_DASHES[x.value]),
                })),
                layer.lineType,
                (value) => {
                    layer.lineType = value;
                },
            );
        };
        return swatch;
    }

    /** The lineweight drawn as itself: a line of that thickness. */
    private lineWeightPreview(layer: Layer) {
        const swatch = this.linePreview(layer.lineWeight, "", "layer.lineWeight");
        swatch.onclick = (e) => {
            e.stopPropagation();
            this.openPicker(
                swatch,
                LAYER_LINE_WEIGHTS.map((weight) => ({
                    value: weight,
                    label: I18n.translate("layer.lineWeight.value", weight),
                    preview: () => this.sampleLine(weight, ""),
                })),
                layer.lineWeight,
                (value) => {
                    layer.lineWeight = value;
                },
            );
        };
        return swatch;
    }

    /** Transparency drawn as itself: the layer colour faded by that much. */
    private transparencyPreview(layer: Layer) {
        const swatch = div({
            className: style.transparency,
            title: I18n.translate("layer.transparency"),
            onclick: (e) => {
                e.stopPropagation();
                this.openPicker(
                    swatch,
                    // Capped at the same ceiling the setter enforces: a layer faded past
                    // this is invisible, and offering a value that gets clamped on the
                    // way in would make the picker lie about what it set.
                    TRANSPARENCY_STEPS.filter((x) => x <= MAX_LAYER_TRANSPARENCY).map((value) => ({
                        value,
                        label: I18n.translate("layer.transparency.value", value),
                        preview: () => this.fadeSample(value),
                    })),
                    layer.transparency,
                    (value) => {
                        layer.transparency = value;
                    },
                );
            },
        });
        swatch.style.opacity = String(1 - layer.transparency / 100);
        return swatch;
    }

    /** A block of the current colour faded by that much, for a transparency picker row. */
    private fadeSample(transparency: number) {
        const sample = div({ className: style.fadeSample });
        sample.style.opacity = String(1 - transparency / 100);
        return sample;
    }

    /**
     * The layer's colour, as the native colour picker.
     *
     * Setting layer.color fires onPropertyChanged, which refreshes the list and so
     * replaces every row - including this input, while the user is still dragging inside
     * the picker it opened. That closed the dialog on the first colour touched and lost
     * the edit, which is why the colour could not be changed at all. So the panel holds
     * off refreshing until the picker is done: `input` paints a live preview straight
     * onto the drawing without a rebuild, and `change` - fired when the dialog is
     * dismissed - is what commits and lets the list rebuild again.
     */
    private colorSwatch(layer: Layer) {
        const picker = input({
            type: "color",
            value: layer.usesThemeColor ? "#ffffff" : `#${layer.color.toString(16).padStart(6, "0")}`,
            className: `${style.swatch} ${layer.usesThemeColor ? style.themeSwatch : ""}`,
            title: I18n.translate("layer.color"),
            onclick: (e) => e.stopPropagation(),
            oninput: (e) => {
                this.suppressRefresh = true;
                const value = Number.parseInt((e.target as HTMLInputElement).value.slice(1), 16);
                picker.style.backgroundColor = `#${value.toString(16).padStart(6, "0")}`;
                picker.classList.remove(style.themeSwatch);
                layer.color = value;
            },
            onchange: (e) => {
                this.suppressRefresh = false;
                layer.color = Number.parseInt((e.target as HTMLInputElement).value.slice(1), 16);
                this.refresh();
            },
            // A safety net, not the normal path: `change` is what usually clears the
            // flag, but it does not fire when the dialog closes on an unchanged colour.
            // Leaving the flag set would freeze the whole list, so blur clears it too.
            onblur: () => {
                if (!this.suppressRefresh) return;
                this.suppressRefresh = false;
                this.refresh();
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
