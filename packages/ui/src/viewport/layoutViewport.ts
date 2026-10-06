import {
    type CollectionChangedArgs,
    Config,
    type CursorType,
    type IApplication,
    type IView,
    PubSub,
} from "@draftworks/core";
import { Cursor } from "../cursor";
import style from "./layoutViewport.module.css";
import { Viewport } from "./viewport";

export class LayoutViewport extends HTMLElement {
    private readonly _viewports: Map<IView, Viewport> = new Map();

    /** The cursor type in force, re-applied when PICKBOX resizes the pickbox in it. */
    private _cursorType: CursorType = "default";

    constructor(readonly app: IApplication) {
        super();
        this.className = style.root;
        // Pickbox cursor from the start, not just once a command publishes a cursor.
        this.style.cursor = Cursor.get(this._cursorType);
        app.views.onCollectionChanged(this._handleViewCollectionChanged);
    }

    private readonly _handleViewCollectionChanged = (args: CollectionChangedArgs) => {
        if (args.action === "add") {
            args.items.forEach((view) => {
                this.createViewport(view);
            });
        } else if (args.action === "remove") {
            args.items.forEach((view) => {
                const viewport = this._viewports.get(view);
                viewport?.remove();
                viewport?.dispose();
                this._viewports.delete(view);
            });
        }
    };

    connectedCallback(): void {
        PubSub.default.sub("activeViewChanged", this._handleActiveViewChanged);
        PubSub.default.sub("viewCursor", this._handleCursor);
        Config.instance.onPropertyChanged(this._handleConfigChanged);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("activeViewChanged", this._handleActiveViewChanged);
        PubSub.default.remove("viewCursor", this._handleCursor);
        Config.instance.removePropertyChanged(this._handleConfigChanged);
    }

    private readonly _handleCursor = (type: CursorType) => {
        this._cursorType = type;
        this.style.cursor = Cursor.get(type);
    };

    // PICKBOX changes the size of the box baked into the cursor image, so re-apply the
    // current cursor to pick up the new size - the overlay crosshair reacts on its own.
    private readonly _handleConfigChanged = (property: keyof Config) => {
        if (property === "pickboxSize") this.style.cursor = Cursor.get(this._cursorType);
    };

    private createViewport(view: IView) {
        const viewport = new Viewport(view);
        viewport.classList.add(style.viewport, style.hidden);
        this.appendChild(viewport);
        this._viewports.set(view, viewport);
        return viewport;
    }

    private readonly _handleActiveViewChanged = (view: IView | undefined) => {
        this._viewports.forEach((v) => {
            if (v.view === view) {
                v.classList.remove(style.hidden);
            } else {
                v.classList.add(style.hidden);
            }
        });
    };
}

customElements.define("chili-viewport", LayoutViewport);
