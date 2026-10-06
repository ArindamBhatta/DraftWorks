import { Config, type CursorType } from "@draftworks/core";
import { CursorParts } from ".";
import style from "./crosshair.module.css";

/**
 * AutoCAD's full crosshair, drawn as an overlay over the viewport rather than baked into
 * the mouse cursor. The cursor image is capped at 32x32 by the browser (see Cursor), so
 * the long arms - the ones that let you line a point up against geometry on the far side
 * of the drawing - have to be drawn here, where nothing caps their length.
 *
 * Two lines that cross at the pointer. Their half-length is `crosshairSize`% of the
 * viewport's shorter side, so CURSORSIZE 100 reaches from the pointer to the edge in
 * every direction - AutoCAD's full-screen crosshair - and 5, the default, is a short
 * cross about the cursor. A small gap is left around the centre so the pickbox in the
 * cursor image is not painted over.
 *
 * Painted twice, wide black under thin white, the same trick the cursor image uses, so
 * the arms stay visible against both the light and the dark canvas without theming.
 *
 * The overlay lets pointer events through (pointer-events: none in the CSS): it is a HUD
 * over the drawing, not something the drawing handlers should ever see.
 */
export class Crosshair extends HTMLElement {
    private readonly lines: SVGGElement;
    /** Whether the active cursor type wants arms at all - hidden for object-pick pointers. */
    private armed = false;
    /**
     * Whether the pointer is over this viewport. Until it is, there is no point to draw the
     * crosshair at, and drawing one would pin it to the top-left corner (x=y=0) as if a
     * point had been placed there. Set by moveTo, cleared by hide.
     */
    private hasPointer = false;
    private x = 0;
    private y = 0;

    constructor() {
        super();
        this.className = style.root;
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        this.lines = document.createElementNS(ns, "g");
        svg.appendChild(this.lines);
        this.appendChild(svg);
        this.hidden = true;
    }

    connectedCallback() {
        Config.instance.onPropertyChanged(this.onConfigChanged);
    }

    disconnectedCallback() {
        Config.instance.removePropertyChanged(this.onConfigChanged);
    }

    private readonly onConfigChanged = (property: keyof Config) => {
        // A CURSORSIZE or PICKBOX change resizes the arms and the centre gap in place.
        if (property === "crosshairSize" || property === "pickboxSize") this.draw();
    };

    /** Pointer left the viewport: no crosshair to draw until it comes back. */
    hide() {
        this.hasPointer = false;
        this.hidden = true;
    }

    /** The cursor type changed - remember whether it draws a crosshair, and redraw. */
    setCursor(type: CursorType) {
        this.armed = CursorParts[type]?.crosshair ?? false;
        this.draw();
    }

    /** The pointer moved to (x, y) in viewport-local pixels. */
    moveTo(x: number, y: number) {
        this.x = x;
        this.y = y;
        this.hasPointer = true;
        this.draw();
    }

    private draw() {
        if (!this.armed || !this.hasPointer) {
            this.hidden = true;
            return;
        }
        this.hidden = false;

        const rect = this.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        // AutoCAD measures CURSORSIZE against the shorter side, so the arms are the same
        // length whichever way the window is stretched.
        const reach = (Math.min(w, h) * Config.instance.crosshairSize) / 100;
        const x = this.x;
        const y = this.y;
        // Half the pickbox, so the arms stop short of the box the way the old cursor did.
        const gap = Config.instance.pickboxSize / 2;

        // Clamped to the viewport so an arm never overshoots the edge when the pointer is
        // near a corner and reach is large - that would grow the SVG and cause scrollbars.
        const left = Math.max(0, x - reach);
        const right = Math.min(w, x + reach);
        const top = Math.max(0, y - reach);
        const bottom = Math.min(h, y + reach);

        const path =
            `M${left} ${y} H${x - gap} M${x + gap} ${y} H${right} ` +
            `M${x} ${top} V${y - gap} M${x} ${y + gap} V${bottom}`;
        this.lines.innerHTML =
            `<path d="${path}" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="3" />` +
            `<path d="${path}" fill="none" stroke="#fff" stroke-width="1" />`;
    }
}

customElements.define("chili-crosshair", Crosshair);
