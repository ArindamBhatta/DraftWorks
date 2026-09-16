// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Config,
    type DraftingAidKey,
    functionKeyFor,
    I18n,
    type I18nKeys,
    Localize,
    type ObjectSnapType,
    ObjectSnapTypes,
    ObjectSnapTypeUtils,
} from "@draftworks/core";
import { button, div, input, label } from "@draftworks/element";
import style from "./snapConfig.module.css";

/**
 * The polar increments AutoCAD offers in its own POLARANG list, which are the angles
 * drawings are actually built from. Config accepts anything from 1 to 90, so a value
 * arriving from storage that is not listed here is still shown and still honoured.
 *
 * 60 is the one that does not divide 90, and so the one that shows why several can be
 * ticked at once: 90 and 60 together give eight directions, which no single increment
 * in this list produces.
 */
const PolarAngles = [90, 60, 45, 30, 22.5, 15, 10, 5];

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
    /**
     * Whether the polar angle popup is open, held on the component rather than in the
     * DOM. Ticking an angle changes Config, which rebuilds this whole element - so a
     * popup whose open state lived on the node it rebuilds would shut after every tick,
     * which is exactly the one thing a multiple-choice list must not do.
     */
    private anglePopupOpen = false;

    constructor() {
        super();
        this.className = style.container;
        Config.instance.onPropertyChanged(this.snapTypeChanged);

        this.render();
    }

    connectedCallback() {
        document.addEventListener("click", this.handleDocumentClick);
    }

    disconnectedCallback() {
        document.removeEventListener("click", this.handleDocumentClick);
        Config.instance.removePropertyChanged(this.snapTypeChanged);
    }

    /** A click anywhere but the popup and its button closes it, as any menu does. */
    private readonly handleDocumentClick = (e: MouseEvent) => {
        if (!this.anglePopupOpen) return;
        if (e.target instanceof Node && this.contains(e.target)) return;
        this.anglePopupOpen = false;
        this.innerHTML = "";
        this.render();
    };

    private readonly snapTypeChanged = (property: keyof Config) => {
        if (
            property === "snapType" ||
            property === "enableSnap" ||
            property === "enableSnapTracking" ||
            property === "enableOrtho" ||
            property === "enableGrid" ||
            property === "enableDynamicInput" ||
            property === "enablePolarTracking" ||
            property === "polarAngles"
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
            // The drafting aids sit just ahead of the perpendicular snap, the way AutoCAD
            // keeps those toggles next to the object snap settings. Polar goes beside
            // Ortho because the two answer the same question - "constrain this to an
            // angle" - and a drafter reaching for one is choosing between them.
            if (snapType.type === ObjectSnapTypes.perpendicular) {
                items.push(
                    this.createAidToggle("enableGrid", "snap.grid", "snap.gridTip"),
                    this.createAidToggle("enableOrtho", "snap.ortho", "snap.orthoTip"),
                    this.createAidToggle("enablePolarTracking", "snap.polar", "snap.polarTip"),
                    this.createPolarAngleSelect(),
                    this.createAidToggle("enableDynamicInput", "snap.dynamicInput", "snap.dynamicInputTip"),
                );
            }
            items.push(this.createSnapCheckbox(snapType.type, snapType.display));
        }
        items.push(this.createAidToggle("enableSnapTracking", "statusBar.tracking", "snap.trackingTip"));

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

    /**
     * One of the drafting aids - GRID, ORTHO, POLAR, OSNAPTRACK, DYN - as a checkbox that
     * names its function key in the tooltip.
     *
     * These were five near-identical methods. They are one because the aids differ only
     * in which flag they hold, and because the function key in the tooltip has to be the
     * key that is actually bound: taking it from `functionKeyFor` means the button and
     * FunctionKeyService cannot end up claiming different keys.
     */
    private createAidToggle(property: DraftingAidKey, display: I18nKeys, tip: I18nKeys) {
        const key = functionKeyFor(property);
        const id = `snap-${property}`;
        return div(
            { title: key ? `${I18n.translate(tip)} (${key})` : I18n.translate(tip) },
            input({
                type: "checkbox",
                id,
                checked: Config.instance[property],
                onclick: () => {
                    Config.instance[property] = !Config.instance[property];
                },
            }),
            label({ htmlFor: id, textContent: new Localize(display) }),
        );
    }

    /**
     * AutoCAD's POLARANG, except that several increments can be in force at once - rays
     * are drawn at every multiple of every angle ticked.
     *
     * A popup of checkboxes rather than a `<select multiple>`: the status bar has room
     * for one short button, and a multi-select that size shows one row at a time, which
     * is the worst way to present a set. The button itself names the current set, so the
     * popup is only needed to change it.
     *
     * Shown greyed rather than hidden while polar tracking is off, so the angles in force
     * stay readable without switching the mode on to find out what they are.
     */
    private createPolarAngleSelect() {
        const enabled = Config.instance.enablePolarTracking;
        const angles = Config.instance.polarAngles;

        const popup = div({ className: style.anglePopup, hidden: !this.anglePopupOpen });
        const trigger = button({
            className: style.angle,
            disabled: !enabled,
            title: I18n.translate("snap.polarAngle"),
            textContent: angles.map((a) => `${a}°`).join(", "),
            onclick: () => {
                this.anglePopupOpen = !this.anglePopupOpen;
                popup.hidden = !this.anglePopupOpen;
            },
        });

        // Angles set from elsewhere - a stored config, a future typed POLARANG - may not
        // be among the offered steps, so they are listed too rather than silently
        // dropped the next time the popup is opened.
        const listed = [...new Set([...PolarAngles, ...angles])].sort((a, b) => b - a);
        popup.append(...listed.map((angle) => this.createAngleOption(angle, angles)));

        return div({ className: style.angleWrap }, trigger, popup);
    }

    private createAngleOption(angle: number, selected: number[]) {
        const id = `polar-angle-${String(angle).replace(".", "-")}`;
        return div(
            input({
                type: "checkbox",
                id,
                checked: selected.includes(angle),
                onclick: (e) => {
                    const checked = (e.target as HTMLInputElement).checked;
                    // Config re-sorts, dedupes and refuses an empty list, so the last
                    // angle cannot be unticked into a polar mode with no rays.
                    Config.instance.polarAngles = checked
                        ? [...Config.instance.polarAngles, angle]
                        : Config.instance.polarAngles.filter((a) => a !== angle);
                },
            }),
            label({ htmlFor: id, textContent: `${angle}°` }),
        );
    }
}

customElements.define("chili-snap-config", SnapConfig);
