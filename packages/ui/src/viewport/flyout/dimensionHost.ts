import { type DimensionAnchors, type IDisposable, type IView, PubSub } from "@draftworks/core";
import style from "./dimensionHost.module.css";

/** Which of the two dimension boxes a host is holding. */
export type DimensionSlot = "first" | "second";

/**
 * The slot on a dimension line that one of the dynamic input boxes moves into.
 *
 * AutoCAD takes the dimension boxes off the crosshair while a shape is being dragged
 * out and puts each beside the geometry it measures. A polar prompt has one such box -
 * the distance, on the segment's own dimension line, while the angle stays at the
 * cursor. A cartesian one has two, the rectangle's width and height, each on the side
 * it belongs to. One host serves each.
 *
 * The host owns only the position. The field itself still belongs to DynamicInput,
 * which parents it here and takes it back when the pick ends - moving the element
 * rather than mirroring it into a second box keeps one input with one value, so focus,
 * Tab and what the user has half-typed survive the journey. An element keeps its
 * focus across a re-parent, which is what makes that safe.
 *
 * It lives in the viewport rather than the flyout because it is anchored to geometry,
 * not to the cursor: the flyout is moved to the pointer on every mouse move, and a
 * child of it would be dragged along off the line it is measuring.
 */
export class DimensionHost extends HTMLElement implements IDisposable {
    /**
     * Whether the last publish gave this host's slot a line to sit on. A cartesian
     * prompt whose rectangle has no height yet offers no second anchor, and the box
     * belonging to it waits at the crosshair rather than at a stale position.
     */
    private anchored = false;

    constructor(readonly which: DimensionSlot = "first") {
        super();
        this.className = style.host;
        this.classList.add(style.hidden);
    }

    connectedCallback(): void {
        PubSub.default.sub("moveDistanceInput", this.place);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("moveDistanceInput", this.place);
    }

    dispose(): void {
        this.remove();
    }

    /** Whether this host currently has somewhere to be. */
    get hasAnchor() {
        return this.anchored;
    }

    /**
     * Projected here rather than handed screen coordinates, so the box lands on the
     * guide as the view currently shows it - a zoom between the publish and the paint
     * would otherwise leave it stranded where the line used to be.
     */
    private readonly place = (anchors: DimensionAnchors, view: IView) => {
        const anchor = anchors[this.which];
        this.anchored = anchor !== undefined;
        if (!anchor) return;

        const mid = anchor.start.add(anchor.end.sub(anchor.start).multiply(0.5));
        const screen = view.worldToScreen(mid);
        if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
            this.anchored = false;
            return;
        }

        this.style.left = `${screen.x}px`;
        this.style.top = `${screen.y}px`;
    };

    /** Shown only while it actually holds the field, so an empty box never flashes up. */
    setOccupied(occupied: boolean) {
        this.classList.toggle(style.hidden, !occupied);
    }
}

customElements.define("chili-dimension-host", DimensionHost);
