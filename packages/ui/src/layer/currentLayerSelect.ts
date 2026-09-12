// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, Localize, type ModelManager } from "@draftworks/core";
import { label, option, select } from "@draftworks/element";
import commonStyle from "../property/common.module.css";
import style from "./currentLayerSelect.module.css";

/**
 * AutoCAD's layer combo: whichever layer is current is where the next object drawn
 * lands. Shown in the properties palette when nothing is selected, the way AutoCAD's own
 * Properties palette falls back to "what will the next object use" rather than going
 * blank - and, same as there, changing it here changes the current layer.
 */
export class CurrentLayerSelect extends HTMLElement {
    private readonly select: HTMLSelectElement;

    constructor(readonly document: IDocument) {
        super();
        this.className = style.panel;
        this.select = select({ className: style.select, onchange: this.setCurrentLayer });
        this.append(
            label({ className: commonStyle.propertyName, textContent: new Localize("layer.current") }),
            this.select,
        );
        this.refresh();
    }

    connectedCallback() {
        const manager = this.document.modelManager;
        manager.layers.onCollectionChanged(this.refresh);
        manager.onPropertyChanged(this.handleManagerChanged);
    }

    disconnectedCallback() {
        const manager = this.document.modelManager;
        manager.layers.removeCollectionChanged(this.refresh);
        manager.removePropertyChanged(this.handleManagerChanged);
    }

    private readonly handleManagerChanged = (property: keyof ModelManager) => {
        if (property === "currentLayerId") this.refresh();
    };

    private readonly refresh = () => {
        const manager = this.document.modelManager;
        const currentId = manager.currentLayerId;
        this.select.replaceChildren(
            ...manager.layers.map((layer) =>
                option({ value: layer.id, textContent: layer.name, selected: layer.id === currentId }),
            ),
        );
    };

    private readonly setCurrentLayer = (e: Event) => {
        this.document.modelManager.currentLayerId = (e.target as HTMLSelectElement).value;
    };
}

customElements.define("chili-current-layer-select", CurrentLayerSelect);
