import { type BoundingBox, type IVisualObject, Matrix4, type TextAnnotation, type XYZ } from "@chili3d/core";

import {
    DoubleSide,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    PlaneGeometry,
    Matrix4 as ThreeMatrix4,
    Vector3,
} from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { Constants } from "./constants";
import type { IHighlightable } from "./highlightable";
import { ThreeHelper } from "./threeHelper";
import type { ThreeVisualContext } from "./threeVisualContext";

const HIGHLIGHT_COLOR = "#00ffff";

/** Keeps text legible when zoomed far out and sane when zoomed far in. */
const MIN_FONT_PX = 6;
const MAX_FONT_PX = 400;

/**
 * Renders one TextAnnotation - both AutoCAD's TEXT and its MTEXT, which differ only in
 * whether the block wraps.
 *
 * Like ThreeDimension, the glyphs are a CSS2D element rather than world-space text
 * geometry, because the app ships no loaded font (ITextGenerator has never had an
 * implementation). The size is driven from the annotation's height in *drawing units*
 * and re-derived on every zoom, so it behaves like real CAD text rather than a
 * fixed-size screen badge.
 *
 * A CSS element cannot be raycast, so the object also carries an invisible quad the
 * size of the rendered text. That quad is what makes text clickable in the viewport -
 * without it the annotation could only be reached from the project tree.
 */
export class ThreeText extends Object3D implements IVisualObject, IHighlightable {
    locked = false;
    transform: Matrix4 = Matrix4.identity();

    private readonly _outer: HTMLDivElement;
    private readonly _inner: HTMLDivElement;
    private readonly _label: CSS2DObject;
    private readonly _hitPlane: Mesh;
    private _pixelsPerUnit = 0;
    private _highlighted = false;

    constructor(
        private readonly context: ThreeVisualContext,
        readonly annotation: TextAnnotation,
    ) {
        super();

        this._inner = document.createElement("div");
        this._inner.style.position = "absolute";
        this._inner.style.left = "0px";
        this._inner.style.userSelect = "none";
        this._inner.style.pointerEvents = "none";
        this._inner.style.lineHeight = "1.5";

        // The renderer owns the outer element's transform (it positions it on screen),
        // so the text's own rotation has to live on a child.
        this._outer = document.createElement("div");
        this._outer.style.position = "relative";
        this._outer.style.width = "0px";
        this._outer.style.height = "0px";
        this._outer.appendChild(this._inner);

        this._label = new CSS2DObject(this._outer);
        // Anchor the element's corner, not its middle, on the insertion point.
        this._label.center.set(0, 0);

        this._hitPlane = new Mesh(
            new PlaneGeometry(1, 1),
            new MeshBasicMaterial({ transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }),
        );
        this._hitPlane.layers.set(Constants.Layers.Wireframe);

        this.add(this._label, this._hitPlane);
        this.rebuild();

        this.annotation.onPropertyChanged(this.handleAnnotationChanged);
    }

    private readonly handleAnnotationChanged = () => {
        this.rebuild();
        this.context.visual.update();
    };

    /** Re-applies everything that comes from the annotation's own fields. */
    rebuild() {
        const { position, content, isMultiline } = this.annotation;

        this._inner.textContent = content;
        this._inner.style.color = this._highlighted ? HIGHLIGHT_COLOR : this.annotationColor();
        this._inner.style.whiteSpace = isMultiline ? "pre-wrap" : "pre";
        this._inner.style.wordBreak = isMultiline ? "break-word" : "normal";

        // MTEXT hangs from its top-left corner; TEXT sits on its baseline and grows up.
        if (isMultiline) {
            this._inner.style.top = "0px";
            this._inner.style.bottom = "";
            this._inner.style.transformOrigin = "0 0";
        } else {
            this._inner.style.top = "";
            this._inner.style.bottom = "0px";
            this._inner.style.transformOrigin = "0 100%";
        }
        // Screen Y runs downwards, so a counter-clockwise drawing rotation is a
        // negative CSS one.
        this._inner.style.transform = `rotate(${-this.annotation.rotation}deg)`;

        this._label.position.set(position.x, position.y, position.z);

        // Force the pixel sizing to be recomputed even if the zoom has not moved.
        const pixelsPerUnit = this._pixelsPerUnit;
        this._pixelsPerUnit = 0;
        if (pixelsPerUnit > 0) this.updateScale(pixelsPerUnit);
        else this.layoutHitPlane(this.annotation.layout());
    }

    private annotationColor(): string {
        return `#${this.annotation.color.toString(16).padStart(6, "0")}`;
    }

    /**
     * Converts the annotation's drawing-unit height into a pixel font size for the
     * current zoom, then re-fits the pick quad to whatever the browser actually laid
     * out. Called from the view's render tick, so it returns early unless the zoom
     * really moved.
     */
    updateScale(pixelsPerUnit: number) {
        if (pixelsPerUnit <= 0 || pixelsPerUnit === this._pixelsPerUnit) return;
        this._pixelsPerUnit = pixelsPerUnit;

        const fontPx = this.annotation.height * pixelsPerUnit;
        this._inner.style.fontSize = `${Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, fontPx))}px`;
        this._inner.style.width = this.annotation.isMultiline
            ? `${this.annotation.boxWidth * pixelsPerUnit}px`
            : "";

        this.layoutHitPlane(this.measure(pixelsPerUnit));
    }

    /**
     * The rendered size in drawing units. The DOM knows the real width of proportional
     * glyphs; the model's estimate only stands in until the element has been laid out
     * (and when the font was clamped, which breaks the units-to-pixels relationship).
     */
    private measure(pixelsPerUnit: number): { width: number; height: number } {
        const estimate = this.annotation.layout();
        const fontPx = this.annotation.height * pixelsPerUnit;
        if (fontPx < MIN_FONT_PX || fontPx > MAX_FONT_PX) return estimate;

        const width = this._inner.offsetWidth / pixelsPerUnit;
        const height = this._inner.offsetHeight / pixelsPerUnit;
        return width > 0 && height > 0 ? { width, height } : estimate;
    }

    /** Puts the invisible pick quad exactly over the text block. */
    private layoutHitPlane(size: { width: number; height: number }) {
        const xDir = this.annotation.rotatedXAxis();
        const normal = this.annotation.normal;
        const yDir = normal.cross(xDir).normalize();
        if (!yDir || size.width <= 0 || size.height <= 0) {
            this._hitPlane.visible = false;
            return;
        }
        this._hitPlane.visible = true;

        const halfUp = this.annotation.isMultiline ? -size.height / 2 : size.height / 2;
        const centre = this.annotation.position.add(xDir.multiply(size.width / 2)).add(yDir.multiply(halfUp));

        this._hitPlane.position.set(centre.x, centre.y, centre.z);
        this._hitPlane.quaternion.setFromRotationMatrix(
            new ThreeMatrix4().makeBasis(toVector(xDir), toVector(yDir), toVector(normal)),
        );
        this._hitPlane.scale.set(size.width, size.height, 1);
    }

    highlight(): void {
        this._highlighted = true;
        this._inner.style.color = HIGHLIGHT_COLOR;
    }

    unhighlight(): void {
        this._highlighted = false;
        this._inner.style.color = this.annotationColor();
    }

    wholeVisual(): Mesh[] {
        return [this._hitPlane];
    }

    boundingBox(): BoundingBox | undefined {
        return ThreeHelper.getBoundingBox(this._hitPlane);
    }

    worldTransform(): Matrix4 {
        return Matrix4.identity();
    }

    dispose(): void {
        this.annotation.removePropertyChanged(this.handleAnnotationChanged);
        this._hitPlane.geometry.dispose();
        (this._hitPlane.material as MeshBasicMaterial).dispose();
        this._inner.remove();
        this._outer.remove();
        this.remove(this._label);
    }
}

function toVector(xyz: XYZ): Vector3 {
    return new Vector3(xyz.x, xyz.y, xyz.z);
}
