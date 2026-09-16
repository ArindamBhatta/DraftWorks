import { I18n, type SelectionCycleOptions } from "@draftworks/core";
import { div, span } from "@draftworks/element";
import style from "./selectionCyclePanel.module.css";

/** Kept clear of the pointer so the list does not open under the cursor that opened it. */
const CURSOR_OFFSET = 12;

/** Room left for the menu before it is flipped to the other side of the pointer. */
const EDGE_MARGIN = 8;

/**
 * AutoCAD's selection cycling list: the objects stacked under a click, for the user to
 * choose between.
 *
 * It opens at the pointer rather than in a corner, because the choice being made is about
 * geometry that is right there and a list somewhere else would mean looking away from it.
 * Hovering a row lights that object up in the drawing, which is what makes the list
 * usable at all - "Line", "Line", "Line" says nothing until one of them flashes.
 */
export class SelectionCyclePanel extends HTMLElement {
    private static current: SelectionCyclePanel | undefined;

    /** Opens the list, replacing one already up - a second click supersedes the first. */
    static show(options: SelectionCycleOptions) {
        SelectionCyclePanel.current?.dismiss(false);
        document.body.append(new SelectionCyclePanel(options));
    }

    /** True once a row has been taken, so dismissing does not also report a cancel. */
    private picked = false;

    constructor(private readonly options: SelectionCycleOptions) {
        super();
        this.className = style.menu;
        this.render();
    }

    connectedCallback() {
        SelectionCyclePanel.current = this;
        // Capture, so Escape closes this before a running command sees it and cancels
        // the command itself - the user is dismissing a menu, not the operation.
        window.addEventListener("keydown", this.handleKeyDown, true);
        // Deferred by a frame: this is opened from a pointerup, and listening for clicks
        // in the same tick would catch the very click that opened it.
        requestAnimationFrame(() => document.addEventListener("pointerdown", this.handlePointerDown, true));
        this.position();
    }

    disconnectedCallback() {
        if (SelectionCyclePanel.current === this) SelectionCyclePanel.current = undefined;
        window.removeEventListener("keydown", this.handleKeyDown, true);
        document.removeEventListener("pointerdown", this.handlePointerDown, true);
    }

    private dismiss(cancelled: boolean) {
        this.remove();
        if (cancelled && !this.picked) this.options.onCancel();
    }

    private readonly handleKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.dismiss(true);
    };

    private readonly handlePointerDown = (e: PointerEvent) => {
        if (e.target instanceof Node && this.contains(e.target)) return;
        this.dismiss(true);
    };

    /**
     * Placed against the pointer, then pulled back inside the window. A menu opened near
     * the right or bottom edge - which is most of the status bar and the whole right-hand
     * side of the drawing - would otherwise run off the screen with no way to scroll to
     * it, since it is positioned rather than laid out.
     */
    private position() {
        const { clientX, clientY } = this.options;
        const { width, height } = this.getBoundingClientRect();

        let left = clientX + CURSOR_OFFSET;
        let top = clientY + CURSOR_OFFSET;
        if (left + width > window.innerWidth - EDGE_MARGIN) left = clientX - width - CURSOR_OFFSET;
        if (top + height > window.innerHeight - EDGE_MARGIN) top = clientY - height - CURSOR_OFFSET;

        this.style.left = `${Math.max(EDGE_MARGIN, left)}px`;
        this.style.top = `${Math.max(EDGE_MARGIN, top)}px`;
    }

    private render() {
        this.append(
            div({ className: style.title, textContent: I18n.translate("statusBar.cyclingPrompt") }),
            ...this.options.items.map((item, index) => this.renderItem(item, index)),
        );
    }

    private renderItem(item: SelectionCycleOptions["items"][number], index: number) {
        const row = div(
            {
                className: style.item,
                onpointerenter: () => item.onHover(),
                onclick: () => {
                    this.picked = true;
                    item.onPick();
                    this.dismiss(false);
                },
            },
            span({ className: style.index, textContent: String(index + 1) }),
            span({ className: style.name, textContent: item.name }),
        );
        if (item.detail) {
            row.append(span({ className: style.detail, textContent: item.detail }));
        }
        return row;
    }
}

customElements.define("chili-selection-cycle", SelectionCyclePanel);
