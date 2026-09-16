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
    StatusBarToggles,
} from "@draftworks/core";
import { button, div } from "@draftworks/element";
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

/**
 * The snap spacings worth a click. Unlike the polar angles these are not a standard set -
 * a drawing's spacing follows whatever it is built on - so the list ends in Custom, and a
 * spacing that arrived from storage is shown whether or not it is one of these.
 */
const SnapSpacings = [0.5, 1, 5, 10, 25, 50, 100];

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

/** Which flyout, if any, is open. Only one may be at a time, as with any menu bar. */
type OpenFlyout = "snap" | "polar" | "osnap" | undefined;

export class SnapConfig extends HTMLElement {
    /**
     * Which flyout is open, held on the component rather than in the DOM. Picking inside
     * one changes Config, which rebuilds this whole element, so a flag that lived on the
     * node being rebuilt would be lost mid-click.
     */
    private openFlyout: OpenFlyout;

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

    private rerender() {
        this.innerHTML = "";
        this.render();
    }

    /** A click anywhere but this strip closes whichever flyout is open, as any menu does. */
    private readonly handleDocumentClick = (e: MouseEvent) => {
        if (!this.openFlyout) return;
        if (e.target instanceof Node && this.contains(e.target)) return;
        this.openFlyout = undefined;
        this.rerender();
    };

    private readonly snapTypeChanged = (property: keyof Config) => {
        // Every setting this strip draws. Listed rather than rebuilding on any change at
        // all, because Config also carries the theme, the language and the trusted
        // domains, none of which this shows.
        const shown: (keyof Config)[] = [
            "snapType",
            "enableSnap",
            "enableSnapTracking",
            "enableOrtho",
            "enableGrid",
            "enableGridSnap",
            "snapSpacing",
            "enableDynamicInput",
            "enablePolarTracking",
            "polarAngles",
            "showLineWeight",
            "enableSelectionCycling",
        ];
        if (shown.includes(property)) this.rerender();
    };

    private handleSnapClick(snapType: ObjectSnapType) {
        if (ObjectSnapTypeUtils.hasType(Config.instance.snapType, snapType)) {
            Config.instance.snapType = ObjectSnapTypeUtils.removeType(Config.instance.snapType, snapType);
        } else {
            Config.instance.snapType = ObjectSnapTypeUtils.addType(Config.instance.snapType, snapType);
        }
    }

    /**
     * The status bar row, in AutoCAD's own order - see `StatusBarToggles`, which is where
     * that order and the set of buttons both live.
     *
     * The individual object snaps (Endpoint, Midpoint, Center...) are no longer buttons of
     * their own out here. They belong to OSNAP: F3 is the master switch and these are what
     * it switches, which is how AutoCAD has it - a row of eight more toggles alongside
     * made them look like eight more independent modes. They are now the flyout on the
     * OSNAP button, the same arrangement the polar angles have on POLAR.
     */
    private render() {
        const items: HTMLElement[] = [];
        for (const toggle of StatusBarToggles) {
            items.push(this.createAidToggle(toggle.property, toggle.label, toggle.description));
            if (toggle.property === "enableGridSnap") items.push(this.createSnapSpacingFlyout());
            if (toggle.property === "enablePolarTracking") items.push(this.createPolarAngleFlyout());
            if (toggle.property === "enableSnap") items.push(this.createObjectSnapFlyout());
        }
        this.append(...items);
    }

    /**
     * A button's settings flyout: the upward arrow, and the list it opens above it.
     *
     * One builder for all three - object snaps, polar angles, snap spacing - because they
     * are the same control with different rows in it, and because the arrow has to look
     * and sit identically on each. They were not: two of them used a wide button showing
     * their current value, which made the row read as though those settings were a
     * different kind of thing from the ones behind OSNAP's arrow. The current value now
     * goes in the tooltip and is visible in the list itself, which is lit for whatever is
     * in force.
     *
     * `tip` carries that value, so the arrow still answers "what is it set to?" on hover
     * without spending status bar width on it.
     */
    private createFlyout(kind: OpenFlyout, enabled: boolean, tip: string, rows: HTMLElement[]) {
        const open = this.openFlyout === kind;
        const trigger = button({
            className: style.flyoutTrigger,
            disabled: !enabled,
            title: tip,
            // A caret rather than an icon: it points at the list, which opens upwards
            // because the status bar is at the bottom of the window.
            textContent: "▴",
            onclick: (e) => {
                // Kept from the document listener. Opening rebuilds this strip, so by the
                // time that listener runs the button it fired on is detached and
                // `contains` says "clicked outside" - shutting the list in the same click
                // that opened it.
                e.stopPropagation();
                this.openFlyout = open ? undefined : kind;
                this.rerender();
            },
        });
        trigger.setAttribute("aria-expanded", String(open));

        return div(
            { className: style.flyoutWrap },
            trigger,
            div({ className: style.flyout, hidden: !open }, ...rows),
        );
    }

    /** One row of a flyout, lit while whatever it names is in force. */
    private createFlyoutOption(label: Localize | string, active: boolean, onclick: () => void) {
        const row = button({
            className: style.flyoutOption,
            textContent: label,
            onclick: (e) => {
                e.stopPropagation();
                onclick();
            },
        });
        row.setAttribute("aria-pressed", String(active));
        return row;
    }

    /**
     * The object snaps themselves, as a flyout from the OSNAP button - AutoCAD's Object
     * Snap Settings, reachable from the same place the mode is switched on.
     *
     * Stays open while snaps are ticked. Unlike the polar angles, where one choice is the
     * usual case, turning object snaps on and off is done in handfuls - closing after
     * each would mean reopening it eight times to set up a drawing.
     */
    private createObjectSnapFlyout() {
        const rows = SnapTypes.map((snapType) =>
            this.createFlyoutOption(
                new Localize(snapType.display),
                ObjectSnapTypeUtils.hasType(Config.instance.snapType, snapType.type),
                () => this.handleSnapClick(snapType.type),
            ),
        );
        return this.createFlyout(
            "osnap",
            Config.instance.enableSnap,
            I18n.translate("snap.objectSnapSettings"),
            rows,
        );
    }

    /**
     * SNAPUNIT, the step F9 rounds to. The conventional spacings, plus a way to type one:
     * unlike polar angles, which come from a short set of standard values, a snap spacing
     * is whatever the drawing is built on and no list would hold every right answer.
     */
    private createSnapSpacingFlyout() {
        const current = Config.instance.snapSpacing;
        const listed = [...new Set([...SnapSpacings, current])].sort((a, b) => a - b);

        const rows = listed.map((spacing) =>
            this.createFlyoutOption(String(spacing), spacing === current, () => {
                this.openFlyout = undefined;
                Config.instance.snapSpacing = spacing;
                this.rerender();
            }),
        );
        rows.push(
            this.createFlyoutOption(`${I18n.translate("snap.snapSpacingCustom")}…`, false, () => {
                this.openFlyout = undefined;
                const answer = window.prompt(I18n.translate("snap.snapSpacing"), String(current));
                // Config refuses a zero, a negative or a NaN and keeps the old spacing, so
                // a mistyped answer cannot put every point at the origin.
                if (answer !== null) Config.instance.snapSpacing = Number(answer);
                this.rerender();
            }),
        );

        return this.createFlyout(
            "snap",
            Config.instance.enableGridSnap,
            `${I18n.translate("snap.snapSpacing")}: ${current}`,
            rows,
        );
    }

    /**
     * A status bar toggle: the button lights up while its mode is on, the way every
     * toggle in AutoCAD's status bar does.
     *
     * A button rather than a checkbox and label because a checkbox states a fact about a
     * form and a status bar states the mode you are drawing in - a row of ticks has to be
     * read one at a time, where lit and unlit are told apart at a glance and from the
     * corner of the eye, which is where the status bar actually gets looked at.
     *
     * `aria-pressed` is what carries the on/off to a screen reader now that there is no
     * checkbox to carry it, and it is also what the stylesheet colours on.
     */
    private createToggleButton(
        textContent: Localize | string,
        active: boolean,
        tip: string,
        onclick: () => void,
    ) {
        const element = button({
            className: style.toggle,
            title: tip,
            textContent,
            onclick,
        });
        element.setAttribute("aria-pressed", String(active));
        return element;
    }

    /**
     * One of the drafting aids - GRID, ORTHO, POLAR, OSNAPTRACK, DYN - naming its function
     * key in the tooltip.
     *
     * These were five near-identical methods. They are one because the aids differ only
     * in which flag they hold, and because the function key in the tooltip has to be the
     * key that is actually bound: taking it from `functionKeyFor` means the button and
     * FunctionKeyService cannot end up claiming different keys.
     */
    private createAidToggle(property: DraftingAidKey, display: I18nKeys, tip: I18nKeys) {
        const key = functionKeyFor(property);
        const title = key ? `${I18n.translate(tip)} (${key})` : I18n.translate(tip);
        return this.createToggleButton(new Localize(display), Config.instance[property], title, () => {
            Config.instance[property] = !Config.instance[property];
        });
    }

    /**
     * AutoCAD's POLARANG, except that several increments can be in force at once - rays
     * are drawn at every multiple of every angle picked.
     *
     * The list opens upwards as a single column, which is both what AutoCAD's own polar
     * flyout does and the only thing that fits: this sits at the bottom of the window, so
     * a menu dropping down would open off the screen, and one laid out in a row would be
     * as wide as the status bar itself.
     */
    private createPolarAngleFlyout() {
        const angles = Config.instance.polarAngles;
        // Angles set from elsewhere - a stored config, a future typed POLARANG - may not
        // be among the offered steps, so they are listed too rather than silently dropped
        // the next time the list is opened.
        const listed = [...new Set([...PolarAngles, ...angles])].sort((a, b) => b - a);

        const rows = listed.map((angle) =>
            this.createFlyoutOption(`${angle}°`, angles.includes(angle), () => {
                // Closed before Config is touched, not after: the assignment below fires a
                // property change that rebuilds this strip on the spot, and a flag set
                // afterwards would render the list open once before closing it again.
                //
                // Closing on pick is how a menu behaves. Picking a second angle means
                // opening it again - the cost of having it get out of the way of the
                // drawing, which is what the status bar is sitting on.
                this.openFlyout = undefined;
                // Config re-sorts, dedupes and refuses an empty list, so the last angle
                // cannot be turned off into a polar mode with no rays at all.
                Config.instance.polarAngles = angles.includes(angle)
                    ? Config.instance.polarAngles.filter((a) => a !== angle)
                    : [...Config.instance.polarAngles, angle];
                this.rerender();
            }),
        );

        return this.createFlyout(
            "polar",
            Config.instance.enablePolarTracking,
            `${I18n.translate("snap.polarAngle")}: ${angles.map((a) => `${a}°`).join(", ")}`,
            rows,
        );
    }
}

customElements.define("chili-snap-config", SnapConfig);
