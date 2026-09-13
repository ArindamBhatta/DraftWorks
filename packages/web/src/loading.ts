/**
 * The full-screen overlay shown while `AppBuilder.build()` runs.
 *
 * This element is on screen before `MainWindow` sets `:root[theme]`, so it cannot use the
 * app's CSS custom properties - they are scoped to that attribute and would resolve to
 * nothing here. It reads `prefers-color-scheme` directly instead, matching the same
 * fallback `applyTheme` uses for `themeMode === "system"`, and mirrors the palette values
 * rather than referencing them.
 */
export class Loading extends HTMLElement {
    #progress?: HTMLElement;
    #label?: HTMLElement;

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this.shadowRoot!.append(this.#styles(), this.#content());
    }

    /**
     * Replace the indeterminate bar with a determinate one. Safe to call repeatedly, and
     * safe never to call - the bar stays indeterminate until a caller has a real fraction.
     *
     * @param fraction 0 to 1.
     * @param message optional status line, e.g. "Loading geometry kernel".
     */
    setProgress(fraction: number, message?: string) {
        const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
        this.#progress?.classList.add("determinate");
        this.#progress?.style.setProperty("--fill", `${percent}%`);
        if (message !== undefined && this.#label) {
            this.#label.textContent = message;
        }
    }

    /** Update the status line without touching the bar. */
    setMessage(message: string) {
        if (this.#label) this.#label.textContent = message;
    }

    #content() {
        const root = document.createElement("div");
        root.className = "sheet";

        const mark = document.createElement("div");
        mark.className = "mark";
        mark.appendChild(this.#logo());

        const title = document.createElement("div");
        title.className = "title";
        title.textContent = "DraftWorks";

        this.#label = document.createElement("div");
        this.#label.className = "label";
        this.#label.textContent = "Starting";
        // The only moving text on screen; announce changes without stealing focus.
        this.#label.setAttribute("role", "status");
        this.#label.setAttribute("aria-live", "polite");

        this.#progress = document.createElement("div");
        this.#progress.className = "bar";

        root.append(mark, title, this.#progress, this.#label);
        return root;
    }

    /**
     * A drafted square: two construction lines, then the outline drawn over them. Idle on
     * a CAD splash beats a spinner, which says "busy" without saying "drawing".
     */
    #logo() {
        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", "0 0 64 64");
        svg.setAttribute("aria-hidden", "true");

        const line = (x1: number, y1: number, x2: number, y2: number, cls: string) => {
            const el = document.createElementNS(NS, "line");
            el.setAttribute("x1", String(x1));
            el.setAttribute("y1", String(y1));
            el.setAttribute("x2", String(x2));
            el.setAttribute("y2", String(y2));
            el.setAttribute("class", cls);
            return el;
        };

        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", "14");
        rect.setAttribute("y", "14");
        rect.setAttribute("width", "36");
        rect.setAttribute("height", "36");
        rect.setAttribute("class", "outline");

        svg.append(
            line(32, 4, 32, 60, "guide"),
            line(4, 32, 60, 32, "guide"),
            rect,
            // Node dots at two corners, the way a snap marker reads in the editor.
            this.#node(NS, 14, 14),
            this.#node(NS, 50, 50),
        );
        return svg;
    }

    #node(ns: string, cx: number, cy: number) {
        const dot = document.createElementNS(ns, "rect");
        dot.setAttribute("x", String(cx - 2.5));
        dot.setAttribute("y", String(cy - 2.5));
        dot.setAttribute("width", "5");
        dot.setAttribute("height", "5");
        dot.setAttribute("class", "node");
        return dot;
    }

    #styles() {
        const style = document.createElement("style");
        style.textContent = `
            :host {
                position: fixed;
                inset: 0;
                z-index: 9999;
                display: grid;
                place-items: center;
                background: #ffffff;
                color: #333333;
                font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                --accent: #0e62d7;
                --muted: #999999;
                --rule: #dddddd;
            }
            @media (prefers-color-scheme: dark) {
                :host {
                    background: #181818;
                    color: #ffffff;
                    --accent: #4a9eff;
                    --muted: #808080;
                    --rule: #4e4e4e;
                }
            }

            .sheet {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 18px;
                width: 220px;
                text-align: center;
            }

            .mark { width: 64px; height: 64px; }
            .mark svg { width: 100%; height: 100%; overflow: visible; }

            .guide {
                stroke: var(--muted);
                stroke-width: 1;
                stroke-dasharray: 4 3;
                opacity: 0.7;
            }

            .outline {
                fill: none;
                stroke: var(--accent);
                stroke-width: 3;
                stroke-linejoin: miter;
                /* 4 x 36 sides; dash the whole perimeter, then draw it on. */
                stroke-dasharray: 144;
                stroke-dashoffset: 144;
                animation: draw 2s ease-in-out infinite;
            }

            .node {
                fill: var(--accent);
                opacity: 0;
                animation: snap 2s ease-in-out infinite;
            }

            .title {
                font-size: 15px;
                font-weight: 600;
                letter-spacing: 0.02em;
            }

            .bar {
                position: relative;
                width: 100%;
                height: 2px;
                background: var(--rule);
                overflow: hidden;
            }
            .bar::after {
                content: "";
                position: absolute;
                inset: 0 auto 0 0;
                width: 40%;
                background: var(--accent);
                animation: sweep 1.4s ease-in-out infinite;
            }
            .bar.determinate::after {
                width: var(--fill, 0%);
                animation: none;
                transition: width 0.25s ease-out;
            }

            .label {
                font-size: 12px;
                color: var(--muted);
                min-height: 1em;
            }

            @keyframes draw {
                0%   { stroke-dashoffset: 144; }
                55%  { stroke-dashoffset: 0; }
                85%  { stroke-dashoffset: 0; }
                100% { stroke-dashoffset: 0; opacity: 0; }
            }
            @keyframes snap {
                0%, 45% { opacity: 0; }
                60%     { opacity: 1; }
                85%     { opacity: 1; }
                100%    { opacity: 0; }
            }
            @keyframes sweep {
                0%   { transform: translateX(-100%); }
                100% { transform: translateX(350%); }
            }

            /* Respect a reduced-motion preference: keep the finished drawing, drop the
               looping animation and the sweeping bar. */
            @media (prefers-reduced-motion: reduce) {
                .outline { stroke-dashoffset: 0; animation: none; }
                .node { opacity: 1; animation: none; }
                .bar::after { animation: none; width: 100%; opacity: 0.35; }
            }
        `;
        return style;
    }
}

customElements.define("chili-loading", Loading);
