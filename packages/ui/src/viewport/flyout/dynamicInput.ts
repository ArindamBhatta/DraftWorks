// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type DynamicInputLocks,
    type DynamicInputMode,
    type DynamicInputState,
    type IDisposable,
    UnitSetup,
} from "@draftworks/core";
import { div, input, span } from "@draftworks/element";
import style from "./dynamicInput.module.css";

/** Which of the two boxes a keystroke is aimed at - what each holds depends on the mode. */
type Field = "first" | "second";

/**
 * AutoCAD's dynamic input: the dimension boxes that ride the crosshair.
 *
 * Both boxes read live off the pick while the user is only moving the mouse. Typing
 * into one pins it - the point then obeys that value and keeps taking the other from
 * the cursor - and Tab moves to the next box, which is the whole `10 Tab 45 Enter`
 * rhythm a draftsman uses to lay down an exact segment without touching the command
 * line. Enter commits whatever the boxes currently describe.
 *
 * Which pair they are is the prompt's to say (see DynamicInputMode). A prompt asking
 * how far and which way gets distance and angle; one asking for two lengths along the
 * axes - RECTANG's other corner - gets X and Y, where a comma moves on to the second
 * box because that is how the same answer is typed at the command line.
 *
 * The widget knows nothing about handlers or documents: everything it can do arrives
 * on the state object (see DynamicInputState in core/src/snap/dynamicInput.ts).
 */
export class DynamicInput extends HTMLElement implements IDisposable {
    private readonly firstBox: HTMLInputElement;
    private readonly secondBox: HTMLInputElement;
    private readonly firstField: HTMLElement;
    private readonly secondField: HTMLElement;
    private readonly firstPrefix: HTMLElement;
    private readonly secondPrefix: HTMLElement;
    private readonly secondSuffix: HTMLElement;
    private readonly firstLock: HTMLElement;
    private readonly secondLock: HTMLElement;

    private state?: DynamicInputState;
    private mode: DynamicInputMode = "polar";
    /** Which boxes the user has typed into. Editing is what pins a box. */
    private pinned = { first: false, second: false };

    constructor() {
        super();
        this.className = style.panel;

        this.firstBox = this.newBox("first");
        this.secondBox = this.newBox("second");
        this.firstLock = span({ className: style.lockMark, textContent: "" });
        this.secondLock = span({ className: style.lockMark, textContent: "" });
        this.firstPrefix = span({ className: style.prefix, textContent: "" });
        this.secondPrefix = span({ className: style.prefix, textContent: "" });
        this.secondSuffix = span({ className: style.prefix, textContent: "" });

        this.firstField = div({ className: style.field }, this.firstPrefix, this.firstBox, this.firstLock);
        this.secondField = div(
            { className: style.field },
            this.secondPrefix,
            this.secondBox,
            this.secondSuffix,
            this.secondLock,
        );

        this.append(this.firstField, this.secondField);
        this.applyMode();
    }

    dispose() {
        this.state = undefined;
    }

    private newBox(which: Field) {
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
        if (state.mode !== this.mode) {
            // A different question is being asked, so nothing pinned against the old
            // one still means anything.
            this.mode = state.mode;
            this.pinned = { first: false, second: false };
            this.applyMode();
        }

        const [first, second] = this.readingText(state);
        if (!this.pinned.first && document.activeElement !== this.firstBox) {
            this.firstBox.value = first;
        }
        if (!this.pinned.second && document.activeElement !== this.secondBox) {
            this.secondBox.value = second;
        }

        this.firstField.classList.toggle(style.locked, this.pinned.first);
        this.secondField.classList.toggle(style.locked, this.pinned.second);
        this.firstLock.textContent = this.pinned.first ? "\u{1F512}" : "";
        this.secondLock.textContent = this.pinned.second ? "\u{1F512}" : "";
    };

    private readingText(state: DynamicInputState): [string, string] {
        if (this.mode === "cartesian") {
            return [UnitSetup.formatLength(state.reading.dx), UnitSetup.formatLength(state.reading.dy)];
        }
        return [UnitSetup.formatLength(state.reading.distance), state.reading.angle.toFixed(2)];
    }

    /** The marks around the boxes that say what they are measuring. */
    private applyMode() {
        const cartesian = this.mode === "cartesian";
        this.firstPrefix.textContent = cartesian ? "X" : "";
        this.secondPrefix.textContent = cartesian ? "Y" : "<";
        this.secondSuffix.textContent = cartesian ? "" : "°";
    }

    /** Start typing at the crosshair, seeded with the keystroke that got us here. */
    readonly focusFirst = (text: string) => {
        this.firstBox.focus();
        if (text === "") {
            this.firstBox.select();
            return;
        }
        this.firstBox.value = text;
        this.pin("first");
    };

    private pin(which: Field) {
        this.pinned[which] = true;
        this.state?.setLocks(this.readLocks());
        this.update(this.state!);
    }

    /**
     * What the boxes currently constrain. A box the user never touched is not a
     * lock, and neither is one holding something unreadable - in both cases the
     * value keeps coming from the cursor.
     */
    private readLocks(): DynamicInputLocks {
        const length = (which: Field, box: HTMLInputElement) =>
            this.pinned[which] ? numberOr(UnitSetup.tryParseLength(box.value)) : undefined;

        if (this.mode === "cartesian") {
            return {
                dx: length("first", this.firstBox),
                dy: length("second", this.secondBox),
            };
        }
        return {
            distance: length("first", this.firstBox),
            angle: this.pinned.second ? numberOr(Number.parseFloat(this.secondBox.value)) : undefined,
        };
    }

    private handleKeyDown(e: KeyboardEvent, which: Field) {
        // The canvas must not also act on these while a box has focus.
        e.stopPropagation();

        // A comma is how the same pair is typed at the command line - `10,6` - so it
        // moves on to the second box rather than landing in the first as a character
        // that would make its value unreadable.
        const isSeparator = e.key === "," && this.mode === "cartesian";
        if (e.key === "Tab" || isSeparator) {
            e.preventDefault();
            // Typing a value and tabbing on pins it, which is what makes
            // `10 Tab 45 Enter` land an exact segment.
            this.pin(which);
            this.moveTo(which === "first" ? "second" : "first");
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
            this.pinned = { first: false, second: false };
            this.state?.setLocks({});
            this.blurBoxes();
        }
    }

    private moveTo(which: Field) {
        const box = which === "first" ? this.firstBox : this.secondBox;
        box.focus();
        box.select();
    }

    private blurBoxes() {
        this.firstBox.blur();
        this.secondBox.blur();
    }

    /** Cleared between picks, so the next segment does not inherit a stale pin. */
    readonly reset = () => {
        this.pinned = { first: false, second: false };
        this.blurBoxes();
    };
}

/** A value only counts as an answer once it reads as a number. */
function numberOr(value: number | undefined): number | undefined {
    return value === undefined || Number.isNaN(value) ? undefined : value;
}

customElements.define("chili-dynamic-input", DynamicInput);
