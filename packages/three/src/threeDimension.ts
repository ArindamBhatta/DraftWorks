// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type BoundingBox,
    type DimensionAnnotation,
    DimensionSetup,
    type IVisualObject,
    Matrix4,
} from "@chili3d/core";
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Object3D } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { Constants } from "./constants";
import type { IHighlightable } from "./highlightable";
import { ThreeHelper } from "./threeHelper";
import type { ThreeVisualContext } from "./threeVisualContext";

const NORMAL_COLOR = 0xffff00;
const HIGHLIGHT_COLOR = 0x00ffff;

/**
 * Renders one DimensionAnnotation: the extension/dimension lines as a line set, the
 * arrowheads as filled triangles, and the measurement as an HTML label.
 *
 * The label is a CSS2D element rather than world-space text geometry because the app
 * ships no loaded font (ITextGenerator has never had an implementation) - but its font
 * size is driven from DimensionSetup.textHeight in drawing units and rescaled as the
 * view zooms, so it behaves like AutoCAD text rather than a fixed-size screen badge.
 */
export class ThreeDimension extends Object3D implements IVisualObject, IHighlightable {
    locked = false;
    transform: Matrix4 = Matrix4.identity();

    private readonly _lines: LineSegments2;
    private readonly _arrows: Mesh;
    private readonly _label: CSS2DObject;
    private readonly _labelElement: HTMLElement;
    private readonly _lineMaterial: LineMaterial;
    private readonly _arrowMaterial: MeshBasicMaterial;
    private _lastFontPx = -1;

    constructor(
        private readonly context: ThreeVisualContext,
        readonly annotation: DimensionAnnotation,
    ) {
        super();

        this._lineMaterial = new LineMaterial({ linewidth: 1, color: NORMAL_COLOR, side: DoubleSide });
        this._arrowMaterial = new MeshBasicMaterial({ color: NORMAL_COLOR, side: DoubleSide });

        this._lines = new LineSegments2(new LineSegmentsGeometry(), this._lineMaterial);
        this._lines.layers.set(Constants.Layers.Wireframe);

        this._arrows = new Mesh(new BufferGeometry(), this._arrowMaterial);
        this._arrows.layers.set(Constants.Layers.Wireframe);

        this._labelElement = document.createElement("div");
        this._labelElement.style.color = "#ffff00";
        this._labelElement.style.whiteSpace = "nowrap";
        this._labelElement.style.userSelect = "none";
        this._labelElement.style.pointerEvents = "none";
        this._label = new CSS2DObject(this._labelElement);

        this.add(this._lines, this._arrows, this._label);
        this.rebuild();

        this.annotation.onPropertyChanged(this.handleAnnotationChanged);
    }

    private readonly handleAnnotationChanged = () => {
        this.rebuild();
    };

    /** Regenerates the line work from the annotation's picked points. */
    rebuild() {
        const geometry = this.annotation.geometry();
        if (!geometry) {
            this.visible = false;
            return;
        }
        this.visible = true;

        // LineSegmentsGeometry throws on an empty position array, so guard it.
        if (geometry.lines.length > 0) {
            const lines = new LineSegmentsGeometry();
            lines.setPositions(geometry.lines);
            lines.computeBoundingBox();
            this._lines.geometry.dispose();
            this._lines.geometry = lines;
        }

        const arrows = new BufferGeometry();
        arrows.setAttribute("position", new BufferAttribute(new Float32Array(geometry.arrows), 3));
        arrows.computeBoundingSphere();
        this._arrows.geometry.dispose();
        this._arrows.geometry = arrows;

        this._labelElement.textContent = geometry.text;
        this._label.position.set(geometry.textPosition.x, geometry.textPosition.y, geometry.textPosition.z);
    }

    /**
     * Keeps the label at DimensionSetup.textHeight *drawing units* tall by converting to
     * pixels at the current zoom. Called from the view's render tick; the guard keeps a
     * steady camera from touching the DOM every frame.
     */
    updateScale(pixelsPerUnit: number) {
        const px = Math.round(DimensionSetup.settings.textHeight * pixelsPerUnit);
        const clamped = Math.max(8, Math.min(72, px));
        if (clamped === this._lastFontPx) return;
        this._lastFontPx = clamped;
        this._labelElement.style.fontSize = `${clamped}px`;
    }

    highlight(): void {
        this._lineMaterial.color.set(HIGHLIGHT_COLOR);
        this._arrowMaterial.color.set(HIGHLIGHT_COLOR);
        this._labelElement.style.color = "#00ffff";
    }

    unhighlight(): void {
        this._lineMaterial.color.set(NORMAL_COLOR);
        this._arrowMaterial.color.set(NORMAL_COLOR);
        this._labelElement.style.color = "#ffff00";
    }

    wholeVisual(): (Mesh | LineSegments2)[] {
        return [this._lines, this._arrows];
    }

    boundingBox(): BoundingBox | undefined {
        return ThreeHelper.getBoundingBox(this);
    }

    worldTransform(): Matrix4 {
        return Matrix4.identity();
    }

    dispose(): void {
        this.annotation.removePropertyChanged(this.handleAnnotationChanged);
        this._lines.geometry?.dispose();
        this._arrows.geometry?.dispose();
        this._lineMaterial.dispose();
        this._arrowMaterial.dispose();
        this._labelElement.remove();
        this.remove(this._label);
    }
}
