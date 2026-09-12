// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Binding, type IEventHandler, type IView, Localize } from "@draftworks/core";
import { div, span, svg } from "@draftworks/element";
import { Flyout } from "./flyout";
import style from "./viewport.module.css";

export class Viewport extends HTMLElement {
    private readonly _flyout: Flyout;
    private readonly _eventCaches: [keyof HTMLElementEventMap, (e: any) => void][] = [];

    constructor(
        readonly view: IView,
        readonly showViewControls: boolean,
    ) {
        super();
        this.className = style.root;
        this._flyout = new Flyout();
        this.render();
        view.setDom(this);
    }

    // No camera-projection switcher: the view is orthographic-only (see
    // ICameraController), so the only view controls left are fit/zoom.
    private render() {
        this.append(
            this.showViewControls
                ? div(
                      {
                          className: style.viewControls,
                          onpointerdown: (ev) => ev.stopPropagation(),
                          onclick: (e) => e.stopPropagation(),
                      },
                      this.createActionControls(),
                  )
                : "",
            this.createViewLabel(),
            this.createUcsIcon(),
        );
    }

    private createActionControls() {
        return div(
            { className: style.border },
            svg({
                icon: "icon-fitcontent",
                title: new Localize("viewport.fitContent"),
                onclick: async (e) => {
                    e.stopPropagation();
                    this.view.cameraController.fitContent();
                    this.view.update();
                },
            }),
            svg({
                icon: "icon-zoomin",
                title: new Localize("viewport.zoomIn"),
                onclick: () => {
                    this.view.cameraController.zoom(this.view.width / 2, this.view.height / 2, -5);
                    this.view.update();
                },
            }),
            svg({
                icon: "icon-zoomout",
                title: new Localize("viewport.zoomOut"),
                onclick: () => {
                    this.view.cameraController.zoom(this.view.width / 2, this.view.height / 2, 5);
                    this.view.update();
                },
            }),
        );
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
        this.appendChild(this._flyout);
    }

    disconnectedCallback() {
        this.removeEvents();
        this._flyout.remove();
    }

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
        this.handleEvent("pointerOut", event);
    };

    private readonly mouseWheel = (event: WheelEvent) => {
        this.handleEvent("mouseWheel", event);
    };
}

customElements.define("chili-uiview", Viewport);
