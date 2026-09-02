// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AutosaveScheduler,
    AutosaveService,
    type AutosaveState,
    autosaveStateLabel,
    autosaveStateShortLabel,
    getCurrentApplication,
    I18n,
    type IDocument,
    type IView,
    PubSub,
} from "@chili3d/core";
import { span, svg } from "@chili3d/element";
import style from "./autosaveControl.module.css";

/**
 * The Autosave readout in the ribbon's Import/Export group.
 *
 * There is no Save button any more - saving happens on its own - and a user who cannot
 * see a Save button will look for one before they trust that. So this sits where that
 * button used to be and says the quiet part out loud: the word "Autosave", and what it
 * has done with the drawing just now. It is a readout, not a switch; there is nothing to
 * turn off.
 *
 * Takes no document: the ribbon is built once at start-up, before any document exists, so
 * this follows the active one the way LayerControl does.
 */
export class AutosaveControl extends HTMLElement {
    #document?: IDocument;
    #scheduler?: AutosaveScheduler;
    private readonly state = span({ className: style.state });

    constructor() {
        super();
        this.className = style.control;
        this.append(
            svg({ className: style.icon, icon: "icon-save" }),
            span({ className: style.title, textContent: I18n.translate("autosave.title") }),
            this.state,
        );

        PubSub.default.sub("activeViewChanged", this.handleActiveViewChanged);
    }

    connectedCallback() {
        // The ribbon is usually built before the first drawing opens, in which case the
        // `activeViewChanged` above is what fills this in. Asking directly covers the
        // other order - a drawing already active by the time this element connects.
        this.setDocument(this.currentDocument());
    }

    disconnectedCallback() {
        PubSub.default.remove("activeViewChanged", this.handleActiveViewChanged);
        this.unsubscribe();
        this.#document = undefined;
    }

    private currentDocument(): IDocument | undefined {
        try {
            return getCurrentApplication().activeView?.document;
        } catch {
            // No application yet - the ribbon can be built without one.
            return undefined;
        }
    }

    private readonly handleActiveViewChanged = (view: IView | undefined) => {
        this.setDocument(view?.document);
    };

    private setDocument(document: IDocument | undefined) {
        if (this.#document === document && this.#scheduler) return;

        this.unsubscribe();
        this.#document = document;
        // Resolved here rather than in the constructor: AutosaveService only hands out
        // schedulers once it has started, which is after the ribbon is built.
        this.#scheduler = document ? AutosaveService.instance?.schedulerOf(document) : undefined;
        this.#scheduler?.onPropertyChanged(this.handleSchedulerChanged);
        this.render(this.#scheduler?.state ?? "idle");
    }

    private unsubscribe() {
        this.#scheduler?.removePropertyChanged(this.handleSchedulerChanged);
        this.#scheduler = undefined;
    }

    private readonly handleSchedulerChanged = (property: keyof AutosaveScheduler) => {
        if (property === "state") this.render(this.#scheduler?.state ?? "idle");
    };

    private render(state: AutosaveState) {
        // I18n.set rather than a plain assignment: it tags the element so the text
        // re-translates in place when the language changes.
        I18n.set(this.state, "textContent", autosaveStateShortLabel(state));
        // The tooltip carries the full sentence the ribbon column has no room for. Before
        // the first edit there is no state to report, so it explains the feature instead -
        // which is the whole reason this control is in the ribbon.
        I18n.set(this, "title", autosaveStateLabel(state) ?? "autosave.explain");
        this.setAttribute("data-state", state);
    }
}

customElements.define("chili-autosave-control", AutosaveControl);
