import { Binding, type CursorType, type IEventHandler, type IView, Localize, PubSub } from "@draftworks/core";
import { div, span } from "@draftworks/element";
import { Crosshair } from "../cursor/crosshair";
import { DimensionHost, Flyout } from "./flyout";
import style from "./viewport.module.css";

export class Viewport extends HTMLElement {
    private readonly _flyout: Flyout;
    /**
     * Where the distance box goes while it rides the dimension line. Anchored to the
     * geometry rather than the cursor, so it sits beside the flyout instead of inside
     * it - the flyout is moved to the pointer on every move.
     */
    private readonly _dimensionHost: DimensionHost;
    /** The second box's own line - a rectangle's height, beside the width's. */
    private readonly _secondDimensionHost: DimensionHost;
    /** AutoCAD's full crosshair, drawn over this viewport - see Crosshair. */
    private readonly _crosshair: Crosshair;
    private readonly _eventCaches: [keyof HTMLElementEventMap, (e: any) => void][] = [];

    constructor(readonly view: IView) {
        super();
        this.className = style.root;
        this._dimensionHost = new DimensionHost("first");
        this._secondDimensionHost = new DimensionHost("second");
        // Handed over rather than looked up: the viewport builds both, so the flyout
        // never has to go hunting through the DOM for where to send its field.
        this._flyout = new Flyout(this._dimensionHost, this._secondDimensionHost);
        this._crosshair = new Crosshair();
        // Armed for the idle "default" pointer from the start - viewCursor is only
        // published once a command runs, so without this the crosshair would stay off
        // until the first pick.
        this._crosshair.setCursor("default");
        this.render();
        view.setDom(this);
    }

    // No zoom buttons: the wheel zooms, and fit is the TOP face of the view cube.
    private render() {
        this.append(this.createViewLabel(), this.createViewCube(), this.createUcsIcon());
    }

    private fitContent() {
        this.view.cameraController.fitContent();
        this.view.update();
    }

    // Static AutoCAD-style viewport corner label: "[<view name>] [2D Wireframe]".
    // This is a 2D-only drafting app locked to a single top-down view and a single
    // wireframe render mode (see Application.createActiveView and ThreeView's default
    // mode) - there's nothing left to switch between, so unlike the old Solid/
    // Wireframe/Solid+Wireframe dropdown this used to be, it's just a label.
    private createViewLabel() {
        return div(
            {
                className: style.viewLabel,
            },
            "[ ",
            span({ textContent: new Binding(this.view, "name") }),
            " ]  [ ",
            span({ textContent: new Localize("viewport.2dWireframe") }),
            " ]",
        );
    }

    // AutoCAD's ViewCube as it looks in plan view: the TOP face inside a compass ring,
    // with the WCS tag underneath. The view is locked to Top (see
    // Application.createActiveView), so TOP is the only face. Clicking it fits the
    // drawing, as clicking a face does in AutoCAD. The ring and the tag let the pointer
    // through to the drawing.
    //
    // The drawing handlers read offsetX/offsetY, which over the face would be measured
    // from the face instead of the view. So the face keeps its pointer events to itself,
    // and a click on it never picks an object or places a point in a running command.
    private createViewCube() {
        // The ring is four arcs with a 20° gap at each compass point, so the letters
        // sit in open space instead of on top of the stroke.
        const markup = `<svg viewBox="0 0 120 136" xmlns="http://www.w3.org/2000/svg">
            <path class="${style.viewCubeRing}" d="M 67.99 14.7 A 46 46 0 0 1 105.3 52.01
                M 105.3 67.99 A 46 46 0 0 1 67.99 105.3
                M 52.01 105.3 A 46 46 0 0 1 14.7 67.99
                M 14.7 52.01 A 46 46 0 0 1 52.01 14.7" />
            <g class="${style.viewCubeCompass}">
                <text x="60" y="14">N</text>
                <text x="106" y="60">E</text>
                <text x="60" y="106">S</text>
                <text x="14" y="60">W</text>
            </g>
            <g class="${style.viewCubeTop}">
                <rect class="${style.viewCubeFace}" x="38" y="38" width="44" height="44" rx="2" />
                <text class="${style.viewCubeFaceText}" x="60" y="60">TOP</text>
            </g>
            <rect class="${style.viewCubeTag}" x="43" y="120" width="34" height="14" rx="3" />
            <text class="${style.viewCubeTagText}" x="60" y="127">WCS</text>
        </svg>`;
        const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
        // Only the face takes pointer events (see the CSS), so everything that reaches
        // these listeners came from the face.
        const keep = (e: Event) => e.stopPropagation();
        return div(
            {
                className: style.viewCube,
                onpointerdown: keep,
                onpointermove: keep,
                onpointerup: keep,
                onwheel: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                },
                onclick: (e) => {
                    e.stopPropagation();
                    this.fitContent();
                },
            },
            doc.documentElement as unknown as SVGSVGElement,
        );
    }

    // AutoCAD-style 2D UCS icon: a fixed screen-space HUD pinned to the bottom-left
    // corner (like AutoCAD's classic 2D Wireframe UCS icon), not a world-space object
    // at the drawing origin - it doesn't move when you pan/zoom the drawing. This
    // replaces the old ThreeVisual AxesHelper cross that used to run through the
    // origin (see ThreeVisual.initScene).
    private createUcsIcon() {
        const markup = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
            <g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <line x1="6" y1="34" x2="30" y2="34" />
                <line x1="6" y1="34" x2="6" y2="10" />
            </g>
            <polygon points="34,34 28,31.5 28,36.5" fill="currentColor" />
            <polygon points="6,6 3.5,12 8.5,12" fill="currentColor" />
            <text x="30" y="26" font-size="9">X</text>
            <text x="10" y="10" font-size="9">Y</text>
        </svg>`;
        const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
        return div({ className: style.ucsIcon }, doc.documentElement as unknown as SVGSVGElement);
    }

    connectedCallback() {
        this.initEvent();
        // Under the flyout and the HUD corners but over the drawing (see the CSS z-index).
        this.appendChild(this._crosshair);
        this.appendChild(this._flyout);
        this.appendChild(this._dimensionHost);
        this.appendChild(this._secondDimensionHost);
        PubSub.default.sub("viewCursor", this._handleCursor);
    }

    disconnectedCallback() {
        this.removeEvents();
        PubSub.default.remove("viewCursor", this._handleCursor);
        this._crosshair.remove();
        this._flyout.remove();
        this._dimensionHost.remove();
        this._secondDimensionHost.remove();
    }

    // The crosshair overlay only draws the arms; which cursor type wants them (and so
    // whether they show at all) comes from the same viewCursor event that sets the pickbox
    // cursor at the LayoutViewport. Fed here rather than subscribed inside the overlay so
    // it stays a dumb HUD the viewport drives.
    private readonly _handleCursor = (type: CursorType) => {
        this._crosshair.setCursor(type);
    };

    dispose() {
        this.removeEvents();
    }

    private initEvent() {
        const events: [keyof HTMLElementEventMap, (e: any) => any][] = [
            ["pointerdown", this.pointerDown],
            ["pointermove", this.pointerMove],
            ["pointerout", this.pointerOut],
            ["pointerup", this.pointerUp],
            ["wheel", this.mouseWheel],
        ];
        events.forEach((v) => {
            this.addEventListenerHandler(v[0], v[1]);
        });
    }

    private addEventListenerHandler(type: keyof HTMLElementEventMap, handler: (e: any) => any) {
        const listener = (e: any) => {
            e.preventDefault();
            handler(e);
        };
        this.addEventListener(type, listener);
        this._eventCaches.push([type, listener]);
    }

    private removeEvents() {
        this._eventCaches.forEach((x) => {
            this.removeEventListener(x[0], x[1]);
        });
        this._eventCaches.length = 0;
    }

    private readonly handleEvent = (
        eventName: Exclude<keyof IEventHandler, "isEnabled" | "dispose">,
        event: PointerEvent | WheelEvent,
    ) => {
        if (this.view.document.visual.eventHandler.isEnabled)
            this.view.document.visual.eventHandler[eventName]?.(this.view, event as any);
        if (this.view.document.visual.viewHandler.isEnabled)
            this.view.document.visual.viewHandler[eventName]?.(this.view, event as any);
    };

    private readonly pointerMove = (event: PointerEvent) => {
        if (this._flyout) {
            this._flyout.style.top = `${event.offsetY}px`;
            this._flyout.style.left = `${event.offsetX}px`;
        }
        this._crosshair.moveTo(event.offsetX, event.offsetY);

        this.handleEvent("pointerMove", event);
    };

    private readonly pointerDown = (event: PointerEvent) => {
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }

        if (this.view.document.application.activeView !== this.view) {
            this.view.document.application.activeView = this.view;
        }

        this.handleEvent("pointerDown", event);
    };

    private readonly pointerUp = (event: PointerEvent) => {
        this.handleEvent("pointerUp", event);
    };

    private readonly pointerOut = (event: PointerEvent) => {
        // No pointer over the drawing, no crosshair - otherwise it freezes at the last
        // point and reads as a placed mark rather than the live cursor it is.
        this._crosshair.hide();
        this.handleEvent("pointerOut", event);
    };

    private readonly mouseWheel = (event: WheelEvent) => {
        this.handleEvent("mouseWheel", event);
    };
}

customElements.define("chili-uiview", Viewport);
