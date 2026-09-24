import { type DynamicInputState, type MessageType, PubSub } from "@draftworks/core";
import type { DimensionHost } from "./dimensionHost";
import { DynamicInput } from "./dynamicInput";
import style from "./flyout.module.css";
import { Tip } from "./tip";

/**
 * What follows the crosshair: the prompt tip and the live distance/angle boxes.
 *
 * Typed text used to be taken here too, in a third box that appeared under the cursor.
 * It is taken on the command line now - see CommandLine - which is where a command line
 * user is already looking. The dimension boxes stay: a number typed during a pick is a
 * distance or an angle, and those belong beside the geometry they measure.
 */
export class Flyout extends HTMLElement {
    private _tip: HTMLElement | undefined;
    private _dynamicInput: DynamicInput | undefined;

    constructor(
        private readonly dimensionHost?: DimensionHost,
        private readonly secondHost?: DimensionHost,
    ) {
        super();
        this.className = style.root;
    }

    connectedCallback(): void {
        PubSub.default.sub("showFloatTip", this.showTip);
        PubSub.default.sub("clearFloatTip", this.clearTip);
        PubSub.default.sub("showDynamicInput", this.showDynamicInput);
        PubSub.default.sub("clearDynamicInput", this.clearDynamicInput);
        PubSub.default.sub("moveDistanceInput", this.moveDistanceInput);
        PubSub.default.sub("restoreDistanceInput", this.restoreDistanceInput);
        PubSub.default.sub("focusDynamicInput", this.focusDynamicInput);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("showFloatTip", this.showTip);
        PubSub.default.remove("clearFloatTip", this.clearTip);
        PubSub.default.remove("showDynamicInput", this.showDynamicInput);
        PubSub.default.remove("clearDynamicInput", this.clearDynamicInput);
        PubSub.default.remove("moveDistanceInput", this.moveDistanceInput);
        PubSub.default.remove("restoreDistanceInput", this.restoreDistanceInput);
        PubSub.default.remove("focusDynamicInput", this.focusDynamicInput);
    }

    /**
     * The boxes are created on the first reading of a pick and kept for its whole
     * run, so the element the user is typing into is never swapped out from under
     * them by the next mouse move.
     */
    private readonly showDynamicInput = (state: DynamicInputState) => {
        if (this._dynamicInput === undefined) {
            this._dynamicInput = new DynamicInput(this.dimensionHost, this.secondHost);
            // Ahead of the tip, so the boxes sit closest to the crosshair.
            this.prepend(this._dynamicInput);
        }
        this._dynamicInput.update(state);
    };

    private readonly clearDynamicInput = () => {
        if (this._dynamicInput === undefined) return;
        this._dynamicInput.reset();
        this._dynamicInput.remove();
        this._dynamicInput.dispose();
        this._dynamicInput = undefined;
    };

    /**
     * There is a dimension line now. The host has already been positioned by its own
     * subscription; this only tells the widget its field has somewhere to go.
     */
    private readonly moveDistanceInput = () => {
        this._dynamicInput?.sendDistanceToDimension();
    };

    /**
     * The segment got too short to dimension - no guide to sit on, so the distance box
     * comes back to the crosshair rather than hanging at a stale position.
     */
    private readonly restoreDistanceInput = () => {
        this._dynamicInput?.bringDistanceHome();
    };

    private readonly focusDynamicInput = (text: string) => {
        this._dynamicInput?.focusFirst(text);
    };

    private readonly showTip = (dom: HTMLElement | { level: MessageType; msg: string }) => {
        if (dom instanceof HTMLElement) {
            this._tip?.remove();

            this._tip = dom;
            this.append(this._tip);
        } else if (this._tip instanceof Tip) {
            this._tip.set(dom.msg, dom.level);
        } else {
            this._tip?.remove();

            this._tip = new Tip(dom.msg, dom.level);
            this.append(this._tip);
        }
    };

    private readonly clearTip = () => {
        if (this._tip !== undefined) {
            this._tip.remove();
            this._tip = undefined;
        }
    };
}

customElements.define("chili-flyout", Flyout);
