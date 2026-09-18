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
import type { DimensionHost } from "./dimensionHost";
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
    /**
     * Which pinned boxes the geometry is actually obeying.
     *
     * Typing is not the same as answering. `1000` passes through `1`, `10` and `100` on
     * the way, and a point that obeyed each of those in turn would collapse the line to
     * a millimetre under the cursor and grow it back - the drawing jumping about while
     * the user is still mid-number, and vanishing entirely at the first keystroke. So a
     * box being edited shows what is being typed and leaves the rubber band at the
     * cursor; only Tab or Enter hands the value to the geometry.
     */
    private applied = { first: false, second: false };
    /**
     * Whether the pick currently has a dimension line for the distance box to ride.
     * Set by the anchor the handler publishes, cleared when it says there is none.
     */
    private hasDimension = false;

    constructor(private readonly dimensionHost?: DimensionHost) {
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
        // The field is a child of the host, not of this element, so removing the widget
        // would leave it behind on screen with nothing driving it. Take it back first.
        this.prepend(this.firstField);
        this.dimensionHost?.setOccupied(false);
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
            this.applied = { first: false, second: false };
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

        this.placeFirstField();
    };

    /**
     * Sends the distance field out to the dimension line, or brings it home.
     *
     * Only a polar pick has a distance to dimension - the cartesian pair are two
     * lengths along the axes, neither of which is the length of the segment - so X and
     * Y stay together at the crosshair where the answer is typed as a pair.
     *
     * The element is moved rather than copied. A second box mirroring the first would
     * be two inputs holding one value, and every keystroke would have to be forwarded
     * between them; moving it keeps one field, and an element carries its focus,
     * selection and half-typed text across a re-parent.
     */
    private placeFirstField() {
        const host = this.dimensionHost;
        if (!host) return;

        // A pick with no guide to sit on keeps the field at the crosshair, however
        // polar the prompt is - see bringDistanceHome.
        const onDimension = this.mode === "polar" && this.hasDimension;
        const parent = onDimension ? host : this;
        if (this.firstField.parentElement === parent) return;

        // Back into its original slot, ahead of the angle field, so the pair reads in
        // the order it is typed.
        if (onDimension) {
            host.append(this.firstField);
        } else {
            this.prepend(this.firstField);
        }
        host.setOccupied(onDimension);
    }

    /**
     * Called when the pick has no dimension line to offer - a segment of no length, so
     * nothing to measure or to hang the box on. The field waits at the crosshair and
     * goes back out on the next reading that does have a guide.
     */
    readonly bringDistanceHome = () => {
        this.hasDimension = false;
        this.placeFirstField();
    };

    /** The counterpart: a guide exists, so the distance box can go and sit on it. */
    readonly sendDistanceToDimension = () => {
        this.hasDimension = true;
        this.placeFirstField();
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

    /**
     * Marks a box as being typed into. The value is held, not yet obeyed - see
     * `applied`; `commitBox` is what hands it to the geometry.
     */
    private pin(which: Field) {
        this.pinned[which] = true;
        this.state?.setLocks(this.readLocks());
        this.update(this.state!);
    }

    /** Tab or Enter: the value in this box is an answer now, so the point obeys it. */
    private commitBox(which: Field) {
        this.pinned[which] = true;
        this.applied[which] = true;
        this.state?.setLocks(this.readLocks());
        this.update(this.state!);
    }

    /**
     * What the boxes currently constrain. A box the user never touched is not a lock,
     * and neither is one holding something unreadable or one still being typed into -
     * in all three cases the value keeps coming from the cursor.
     */
    private readLocks(): DynamicInputLocks {
        const length = (which: Field, box: HTMLInputElement) =>
            this.applied[which] ? numberOr(UnitSetup.tryParseLength(box.value)) : undefined;

        if (this.mode === "cartesian") {
            return {
                dx: length("first", this.firstBox),
                dy: length("second", this.secondBox),
            };
        }
        return {
            distance: length("first", this.firstBox),
            angle: this.applied.second ? numberOr(Number.parseFloat(this.secondBox.value)) : undefined,
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
            // Tabbing on is how a typed value becomes an answer, which is what makes
            // `10 Tab 45 Enter` land an exact segment: the distance takes hold here,
            // and the angle follows in the box Tab moves to.
            this.commitBox(which);
            this.moveTo(which === "first" ? "second" : "first");
            return;
        }

        if (e.key === "Enter") {
            e.preventDefault();
            this.commitBox(which);
            this.state?.commit(this.readLocks());
            return;
        }

        if (e.key === "Escape") {
            e.preventDefault();
            // Escape releases the boxes and hands the point back to the mouse; a
            // second Escape reaches the canvas and cancels the command itself.
            this.pinned = { first: false, second: false };
            this.applied = { first: false, second: false };
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
        this.applied = { first: false, second: false };
        this.blurBoxes();
    };
}

/** A value only counts as an answer once it reads as a number. */
function numberOr(value: number | undefined): number | undefined {
    return value === undefined || Number.isNaN(value) ? undefined : value;
}

customElements.define("chili-dynamic-input", DynamicInput);
