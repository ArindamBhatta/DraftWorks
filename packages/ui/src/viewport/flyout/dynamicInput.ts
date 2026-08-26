// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type DynamicInputState, type IDisposable, UnitSetup } from "@chili3d/core";
import { div, input, span } from "@chili3d/element";
import style from "./dynamicInput.module.css";

/**
 * AutoCAD's dynamic input: the distance and angle boxes that ride the crosshair.
 *
 * Both boxes read live off the pick while the user is only moving the mouse. Typing
 * into one pins it - the point then obeys that value and keeps taking the other from
 * the cursor - and Tab moves to the next box, which is the whole `10 Tab 45 Enter`
 * rhythm a draftsman uses to lay down an exact segment without touching the command
 * line. Enter commits whatever the boxes currently describe.
 *
 * The widget knows nothing about handlers or documents: everything it can do arrives
 * on the state object (see DynamicInputState in core/src/snap/dynamicInput.ts).
 */
export class DynamicInput extends HTMLElement implements IDisposable {
    private readonly distanceBox: HTMLInputElement;
    private readonly angleBox: HTMLInputElement;
    private readonly distanceField: HTMLElement;
    private readonly angleField: HTMLElement;
    private readonly distanceLock: HTMLElement;
    private readonly angleLock: HTMLElement;

    private state?: DynamicInputState;
    /** Which boxes the user has typed into. Editing is what pins a box. */
    private pinned = { distance: false, angle: false };

    constructor() {
        super();
        this.className = style.panel;

        this.distanceBox = this.newBox("distance");
        this.angleBox = this.newBox("angle");
        this.distanceLock = span({ className: style.lockMark, textContent: "" });
        this.angleLock = span({ className: style.lockMark, textContent: "" });

        this.distanceField = div({ className: style.field }, this.distanceBox, this.distanceLock);
        this.angleField = div(
            { className: style.field },
            span({ className: style.prefix, textContent: "<" }),
            this.angleBox,
            span({ className: style.prefix, textContent: "°" }),
            this.angleLock,
        );

        this.append(this.distanceField, this.angleField);
    }

    dispose() {
        this.state = undefined;
    }

    private newBox(which: "distance" | "angle") {
        return input({
            type: "text",
            className: style.box,
            spellcheck: false,
            autocomplete: "off",
            oninput: () => this.pin(which),
            onkeydown: (e) => this.handleKeyDown(e, which),
        });
    }

    /**
     * The live update, on every mouse move. Whatever the user is typing stays put:
     * only boxes they have not pinned follow the cursor.
     */
    readonly update = (state: DynamicInputState) => {
        this.state = state;

        if (!this.pinned.distance && document.activeElement !== this.distanceBox) {
            this.distanceBox.value = UnitSetup.formatLength(state.reading.distance);
        }
        if (!this.pinned.angle && document.activeElement !== this.angleBox) {
            this.angleBox.value = state.reading.angle.toFixed(2);
        }

        this.distanceField.classList.toggle(style.locked, this.pinned.distance);
        this.angleField.classList.toggle(style.locked, this.pinned.angle);
        this.distanceLock.textContent = this.pinned.distance ? "\u{1F512}" : "";
        this.angleLock.textContent = this.pinned.angle ? "\u{1F512}" : "";
    };

    /** Start typing at the crosshair, seeded with the keystroke that got us here. */
    readonly focusDistance = (text: string) => {
        this.distanceBox.focus();
        if (text === "") {
            this.distanceBox.select();
            return;
        }
        this.distanceBox.value = text;
        this.pin("distance");
    };

    private pin(which: "distance" | "angle") {
        this.pinned[which] = true;
        this.state?.setLocks(this.readLocks());
        this.update(this.state!);
    }

    /**
     * What the boxes currently constrain. A box the user never touched is not a
     * lock, and neither is one holding something unreadable - in both cases the
     * value keeps coming from the cursor.
     */
    private readLocks() {
        const distance = this.pinned.distance ? UnitSetup.tryParseLength(this.distanceBox.value) : undefined;
        const angle = this.pinned.angle ? Number.parseFloat(this.angleBox.value) : undefined;
        return {
            distance: distance === undefined || Number.isNaN(distance) ? undefined : distance,
            angle: angle === undefined || Number.isNaN(angle) ? undefined : angle,
        };
    }

    private handleKeyDown(e: KeyboardEvent, which: "distance" | "angle") {
        // The canvas must not also act on these while a box has focus.
        e.stopPropagation();

        if (e.key === "Tab") {
            e.preventDefault();
            // Typing a value and tabbing on pins it, which is what makes
            // `10 Tab 45 Enter` land an exact segment.
            this.pin(which);
            (which === "distance" ? this.angleBox : this.distanceBox).focus();
            (which === "distance" ? this.angleBox : this.distanceBox).select();
            return;
        }

        if (e.key === "Enter") {
            e.preventDefault();
            this.pin(which);
            this.state?.commit(this.readLocks());
            return;
        }

        if (e.key === "Escape") {
            e.preventDefault();
            // Escape releases the boxes and hands the point back to the mouse; a
            // second Escape reaches the canvas and cancels the command itself.
            this.pinned = { distance: false, angle: false };
            this.state?.setLocks({});
            this.blurBoxes();
        }
    }

    private blurBoxes() {
        this.distanceBox.blur();
        this.angleBox.blur();
    }

    /** Cleared between picks, so the next segment does not inherit a stale pin. */
    readonly reset = () => {
        this.pinned = { distance: false, angle: false };
        this.blurBoxes();
    };
}

customElements.define("chili-dynamic-input", DynamicInput);
