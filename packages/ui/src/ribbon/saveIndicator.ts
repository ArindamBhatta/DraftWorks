// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AutosaveScheduler,
    AutosaveService,
    type AutosaveState,
    autosaveStateLabel,
    I18n,
    type IDocument,
} from "@chili3d/core";
import style from "./saveIndicator.module.css";

/**
 * The save status, sitting beside the drawing name the way Google Drive puts it beside a
 * document title - the same place, and the same job: a quiet line the user can glance at
 * to know their work is somewhere other than this tab.
 *
 * Subscribing in `connectedCallback` and unsubscribing in `disconnectedCallback` is what
 * keeps this from leaking: the ribbon's collection removes a view's tab from the DOM when
 * the drawing closes but never disposes the elements inside it, so the element has to
 * clean up after itself.
 */
export class SaveIndicator extends HTMLElement {
    #scheduler?: AutosaveScheduler;

    constructor(readonly document: IDocument) {
        super();
        this.className = style.indicator;
    }

    connectedCallback() {
        this.#scheduler = AutosaveService.instance?.schedulerOf(this.document);
        this.#scheduler?.onPropertyChanged(this.onSchedulerChanged);
        this.render(this.#scheduler?.state ?? "idle");
    }

    disconnectedCallback() {
        this.#scheduler?.removePropertyChanged(this.onSchedulerChanged);
        this.#scheduler = undefined;
    }

    private readonly onSchedulerChanged = (property: keyof AutosaveScheduler) => {
        if (property === "state") this.render(this.#scheduler?.state ?? "idle");
    };

    private render(state: AutosaveState) {
        const key = autosaveStateLabel(state);
        // `idle` has no label - a drawing that has not been touched yet gets no claim
        // made about it, and the empty element collapses out of the layout via CSS.
        if (key === undefined) {
            this.textContent = "";
            this.removeAttribute("data-state");
            return;
        }

        // I18n.set rather than a plain assignment: it tags the element so the text
        // re-translates in place when the language changes.
        I18n.set(this, "textContent", key);
        this.setAttribute("data-state", state);
    }
}

customElements.define("chili-save-indicator", SaveIndicator);
