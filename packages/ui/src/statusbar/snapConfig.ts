// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Config,
    type I18nKeys,
    Localize,
    type ObjectSnapType,
    ObjectSnapTypes,
    ObjectSnapTypeUtils,
} from "@chili3d/core";
import { div, input, label } from "@chili3d/element";
import style from "./snapConfig.module.css";

const SnapTypes: Array<{
    type: ObjectSnapType;
    display: I18nKeys;
}> = [
    {
        type: ObjectSnapTypes.endPoint,
        display: "snap.end",
    },
    {
        type: ObjectSnapTypes.midPoint,
        display: "snap.mid",
    },
    {
        type: ObjectSnapTypes.center,
        display: "snap.center",
    },
    {
        type: ObjectSnapTypes.perpendicular,
        display: "snap.perpendicular",
    },
    {
        type: ObjectSnapTypes.intersection,
        display: "snap.intersection",
    },
    {
        type: ObjectSnapTypes.tangent,
        display: "snap.tangent",
    },
    {
        type: ObjectSnapTypes.onCurve,
        display: "snap.nearCurve",
    },
    {
        type: ObjectSnapTypes.onSurface,
        display: "snap.onSurface",
    },
];

export class SnapConfig extends HTMLElement {
    constructor() {
        super();
        this.className = style.container;
        Config.instance.onPropertyChanged(this.snapTypeChanged);

        this.render();
    }

    private readonly snapTypeChanged = (property: keyof Config) => {
        if (
            property === "snapType" ||
            property === "enableSnap" ||
            property === "enableSnapTracking" ||
            property === "enableOrtho" ||
            property === "enableGrid"
        ) {
            this.innerHTML = "";
            this.render();
        }
    };

    private handleSnapClick(snapType: ObjectSnapType) {
        if (ObjectSnapTypeUtils.hasType(Config.instance.snapType, snapType)) {
            Config.instance.snapType = ObjectSnapTypeUtils.removeType(Config.instance.snapType, snapType);
        } else {
            Config.instance.snapType = ObjectSnapTypeUtils.addType(Config.instance.snapType, snapType);
        }
    }

    private render() {
        const items: HTMLElement[] = [];
        for (const snapType of SnapTypes) {
            // GRID and ORTHO sit just ahead of the perpendicular snap, the way AutoCAD
            // keeps those two toggles next to the object snap settings.
            if (snapType.type === ObjectSnapTypes.perpendicular) {
                items.push(this.createGridToggle(), this.createOrthoToggle());
            }
            items.push(this.createSnapCheckbox(snapType.type, snapType.display));
        }
        items.push(this.createTrackingCheckbox());

        this.append(...items);
    }

    private createSnapCheckbox(type: ObjectSnapType, display: I18nKeys) {
        return div(
            input({
                type: "checkbox",
                id: `snap-${type}`,
                checked: ObjectSnapTypeUtils.hasType(Config.instance.snapType, type),
                onclick: () => this.handleSnapClick(type),
            }),
            label({
                htmlFor: `snap-${type}`,
                textContent: new Localize(display),
            }),
        );
    }

    private createGridToggle() {
        return div(
            { title: new Localize("snap.gridTip") },
            input({
                type: "checkbox",
                id: "snap-grid",
                checked: Config.instance.enableGrid,
                onclick: () => {
                    Config.instance.enableGrid = !Config.instance.enableGrid;
                },
            }),
            label({
                htmlFor: "snap-grid",
                textContent: new Localize("snap.grid"),
            }),
        );
    }

    private createOrthoToggle() {
        return div(
            { title: new Localize("snap.orthoTip") },
            input({
                type: "checkbox",
                id: "snap-ortho",
                checked: Config.instance.enableOrtho,
                onclick: () => {
                    Config.instance.enableOrtho = !Config.instance.enableOrtho;
                },
            }),
            label({
                htmlFor: "snap-ortho",
                textContent: new Localize("snap.ortho"),
            }),
        );
    }

    private createTrackingCheckbox() {
        return div(
            input({
                type: "checkbox",
                id: "snap-tracking",
                checked: Config.instance.enableSnapTracking,
                onclick: () => {
                    Config.instance.enableSnapTracking = !Config.instance.enableSnapTracking;
                },
            }),
            label({
                htmlFor: "snap-tracking",
                textContent: new Localize("statusBar.tracking"),
            }),
        );
    }
}

customElements.define("chili-snap-config", SnapConfig);
