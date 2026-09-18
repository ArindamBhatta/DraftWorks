import { type DimensionAnchor, type IDisposable, type IView, PubSub } from "@draftworks/core";
import style from "./dimensionHost.module.css";

/**
 * The slot on the dimension line that the distance box moves into.
 *
 * AutoCAD splits the two dimension boxes while a segment is being dragged out: the
 * angle stays at the crosshair, and the distance goes out to sit on the dimension
 * line, beside the geometry it measures. This is where it goes.
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
    constructor() {
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

    /**
     * Projected here rather than handed screen coordinates, so the box lands on the
     * guide as the view currently shows it - a zoom between the publish and the paint
     * would otherwise leave it stranded where the line used to be.
     */
    private readonly place = (anchor: DimensionAnchor, view: IView) => {
        const mid = anchor.start.add(anchor.end.sub(anchor.start).multiply(0.5));
        const screen = view.worldToScreen(mid);
        if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return;

        this.style.left = `${screen.x}px`;
        this.style.top = `${screen.y}px`;
    };

    /** Shown only while it actually holds the field, so an empty box never flashes up. */
    setOccupied(occupied: boolean) {
        this.classList.toggle(style.hidden, !occupied);
    }
}

customElements.define("chili-dimension-host", DimensionHost);
