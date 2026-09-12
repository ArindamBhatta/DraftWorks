import {
    type BoundingBox,
    type DimensionAnnotation,
    type DimensionLabel,
    type DimensionSettings,
    DimensionSetup,
    type IVisualObject,
    Matrix4,
    resolveDimensionColor,
} from "@draftworks/core";
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Object3D } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { Constants } from "./constants";
import type { IHighlightable } from "./highlightable";
import { selectedEdgeMaterial } from "./materials";
import { ThreeHelper } from "./threeHelper";
import type { ThreeVisualContext } from "./threeVisualContext";

/** What a dimension is drawn in when its style says ByBlock or ByLayer. */
const NORMAL_COLOR = "#ffff00";
const HIGHLIGHT_COLOR = "#00ffff";

/**
 * A LineSegmentsGeometry gains its `instanceStart`/`instanceEnd` attributes only when
 * `setPositions` runs. Constructing one and leaving it bare is what three's line raycast
 * cannot survive: `raycastScreenSpace` reads `instanceStart.count` unguarded, so a bare
 * geometry throws on the next pointer move - and because that happens inside
 * `intersectObjects`, it takes down hit detection for every other object in the scene,
 * not just the dimension.
 *
 * An empty array is safe and is the point of this helper: both attributes get created
 * with a count of zero, which raycasting and rendering handle fine.
 */
export function lineGeometry(positions: ArrayLike<number>): LineSegmentsGeometry {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions instanceof Float32Array ? positions : Array.from(positions));
    geometry.computeBoundingBox();
    return geometry;
}

/**
 * Renders one DimensionAnnotation: the extension/dimension lines as two line sets, the
 * arrowheads as filled triangles, and the measurement as an HTML label.
 *
 * The lines are split in two because DIMSTYLE colours and weights the dimension line and
 * the extension lines separately, and a LineMaterial carries one colour for the whole set.
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
    private readonly _extensionLines: LineSegments2;
    private readonly _arrows: Mesh;
    private readonly _label: CSS2DObject;
    private readonly _labelElement: HTMLElement;
    /**
     * The rotated inner box. CSS2DRenderer overwrites `transform` on the element it is
     * given, so the label's own rotation has to live one level down or it is wiped on the
     * next frame.
     */
    private readonly _labelInner: HTMLElement;
    private readonly _lineMaterial: LineMaterial;
    private readonly _extensionMaterial: LineMaterial;
    private readonly _arrowMaterial: MeshBasicMaterial;
    private _lastFontPx = -1;
    /** The style's own colours, so unhighlighting restores them rather than the default. */
    private _dimColor = NORMAL_COLOR;
    private _extColor = NORMAL_COLOR;
    private _textColor = NORMAL_COLOR;

    constructor(
        private readonly context: ThreeVisualContext,
        readonly annotation: DimensionAnnotation,
    ) {
        super();

        this._lineMaterial = new LineMaterial({ linewidth: 1, color: NORMAL_COLOR, side: DoubleSide });
        this._extensionMaterial = new LineMaterial({ linewidth: 1, color: NORMAL_COLOR, side: DoubleSide });
        this._arrowMaterial = new MeshBasicMaterial({ color: NORMAL_COLOR, side: DoubleSide });

        this._lines = new LineSegments2(lineGeometry([]), this._lineMaterial);
        this._lines.layers.set(Constants.Layers.Wireframe);

        this._extensionLines = new LineSegments2(lineGeometry([]), this._extensionMaterial);
        this._extensionLines.layers.set(Constants.Layers.Wireframe);

        this._arrows = new Mesh(new BufferGeometry(), this._arrowMaterial);
        this._arrows.layers.set(Constants.Layers.Wireframe);

        this._labelElement = document.createElement("div");
        this._labelElement.style.whiteSpace = "nowrap";
        this._labelElement.style.userSelect = "none";
        this._labelElement.style.pointerEvents = "none";
        this._labelInner = document.createElement("div");
        this._labelElement.appendChild(this._labelInner);
        this._label = new CSS2DObject(this._labelElement);

        this.add(this._lines, this._extensionLines, this._arrows, this._label);
        this.rebuild();

        this.annotation.onPropertyChanged(this.handleAnnotationChanged);
    }

    private readonly handleAnnotationChanged = () => {
        this.rebuild();
    };

    /** Regenerates the line work from the annotation's picked points. */
    rebuild() {
        const geometry = this.annotation.geometry();
        const style = DimensionSetup.settings;

        // Degenerate input - coincident points, a collinear third point, a near-zero
        // radius - yields no geometry at all. Such a dimension has to be emptied, not
        // merely hidden: three raycasts objects regardless of `visible`, so leaving the
        // previous line work in place would keep an invisible dimension pickable.
        this.visible = geometry !== undefined;

        this._lines.geometry.dispose();
        this._lines.geometry = lineGeometry(geometry?.dimensionLines ?? []);
        // Needed by the dashed selection material; the line work is rebuilt from scratch
        // here, so the distances have to be recomputed with it. Safe on an emptied
        // geometry - `lineGeometry` always creates the instance attributes, at count zero.
        this._lines.computeLineDistances();

        this._extensionLines.geometry.dispose();
        this._extensionLines.geometry = lineGeometry(geometry?.extensionLines ?? []);
        this._extensionLines.computeLineDistances();

        const arrows = new BufferGeometry();
        arrows.setAttribute("position", new BufferAttribute(new Float32Array(geometry?.arrows ?? []), 3));
        arrows.computeBoundingSphere();
        this._arrows.geometry.dispose();
        this._arrows.geometry = arrows;

        this.applyStyle(style);
        this.renderLabel(geometry?.label, style);

        if (geometry) {
            const { x, y, z } = geometry.textPosition;
            this._label.position.set(x, y, z);
            // Screen Y runs down and the drawing's runs up, so an in-plane counter-
            // clockwise rotation is a clockwise one on screen.
            const degrees = (-geometry.textRotation * 180) / Math.PI;
            this._labelInner.style.transform = `rotate(${degrees}deg)`;
        }
    }

    /** DIMCLRD/DIMCLRE/DIMLWD/DIMLWE - the colours and weights of the line work. */
    private applyStyle(style: DimensionSettings) {
        this._dimColor = resolveDimensionColor(style.dimLineColor) ?? NORMAL_COLOR;
        this._extColor = resolveDimensionColor(style.extLineColor) ?? NORMAL_COLOR;
        this._textColor = resolveDimensionColor(style.textColor) ?? NORMAL_COLOR;

        this._lineMaterial.color.set(this._dimColor);
        this._lineMaterial.linewidth = style.dimLineWeight;
        this._extensionMaterial.color.set(this._extColor);
        this._extensionMaterial.linewidth = style.extLineWeight;
        this._arrowMaterial.color.set(this._dimColor);
        this._labelElement.style.color = this._textColor;
    }

    /**
     * The label, with everything the Text, Alternate Units and Tolerances tabs put in it:
     * the measurement, a stacked tolerance beside it at DIMTFAC, the alternate value on
     * its own line, a fill behind it and the box a Basic tolerance draws round it.
     */
    private renderLabel(label: DimensionLabel | undefined, style: DimensionSettings) {
        this._labelInner.replaceChildren();
        this._labelInner.style.display = "inline-flex";
        this._labelInner.style.flexDirection = "column";
        this._labelInner.style.alignItems = "center";
        this._labelInner.style.lineHeight = "1.1";
        this._labelInner.style.padding = label?.boxed || style.textFill !== "none" ? "0.15em 0.3em" : "";
        this._labelInner.style.border = label?.boxed ? `0.06em solid ${this._textColor}` : "";
        this._labelInner.style.backgroundColor =
            style.textFill === "none"
                ? ""
                : style.textFill === "background"
                  ? "var(--background-color, #000)"
                  : (resolveDimensionColor(style.textFillColor) ?? "transparent");

        if (!label) return;

        const row = document.createElement("div");
        row.style.display = "inline-flex";
        row.style.alignItems = "center";

        if (label.text) {
            const main = document.createElement("span");
            main.textContent = label.text;
            row.appendChild(main);
        }

        if (label.tolerance) {
            const { upper, lower } = label.tolerance;
            const stack = document.createElement("span");
            stack.style.fontSize = `${label.toleranceScale}em`;
            stack.style.marginLeft = label.text ? "0.15em" : "";

            if (lower === undefined) {
                // Symmetrical: a single ± on the measurement's own line.
                stack.textContent = upper;
            } else {
                stack.style.display = "inline-flex";
                stack.style.flexDirection = "column";
                stack.style.alignItems = "flex-start";
                stack.style.lineHeight = "1";
                for (const value of [upper, lower]) {
                    const line = document.createElement("span");
                    line.textContent = value;
                    stack.appendChild(line);
                }
                // DIMTOLJ: which of the two lines the measurement sits against.
                row.style.alignItems =
                    label.toleranceAlignment === "top"
                        ? "flex-start"
                        : label.toleranceAlignment === "bottom"
                          ? "flex-end"
                          : "center";
            }
            row.appendChild(stack);
        }

        this._labelInner.appendChild(row);

        if (label.secondary) {
            const secondary = document.createElement("div");
            secondary.textContent = label.secondary;
            this._labelInner.appendChild(secondary);
        }
    }

    /**
     * Keeps the label at DimensionSetup.textHeight *drawing units* tall by converting to
     * pixels at the current zoom. Called from the view's render tick; the guard keeps a
     * steady camera from touching the DOM every frame.
     */
    updateScale(pixelsPerUnit: number) {
        const style = DimensionSetup.settings;
        const px = Math.round(style.textHeight * style.overallScale * pixelsPerUnit);
        const clamped = Math.max(8, Math.min(72, px));
        if (clamped === this._lastFontPx) return;
        this._lastFontPx = clamped;
        this._labelElement.style.fontSize = `${clamped}px`;
    }

    /**
     * A picked dimension gets the same dashed line work as any other selected object;
     * merely hovering one only recolours it. The arrows and label have no line work to
     * dash, so they carry the highlight colour in both cases.
     */
    highlight(selected?: boolean): void {
        this._lines.material = selected ? selectedEdgeMaterial : this._lineMaterial;
        this._extensionLines.material = selected ? selectedEdgeMaterial : this._extensionMaterial;
        this._lineMaterial.color.set(HIGHLIGHT_COLOR);
        this._extensionMaterial.color.set(HIGHLIGHT_COLOR);
        this._arrowMaterial.color.set(HIGHLIGHT_COLOR);
        this._labelElement.style.color = HIGHLIGHT_COLOR;
    }

    unhighlight(): void {
        this._lines.material = this._lineMaterial;
        this._extensionLines.material = this._extensionMaterial;
        // Back to the style's own colours, not the default - a dimension drawn in red
        // stays red after being hovered.
        this._lineMaterial.color.set(this._dimColor);
        this._extensionMaterial.color.set(this._extColor);
        this._arrowMaterial.color.set(this._dimColor);
        this._labelElement.style.color = this._textColor;
    }

    wholeVisual(): (Mesh | LineSegments2)[] {
        return [this._lines, this._extensionLines, this._arrows];
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
        this._extensionLines.geometry?.dispose();
        this._arrows.geometry?.dispose();
        this._lineMaterial.dispose();
        this._extensionMaterial.dispose();
        this._arrowMaterial.dispose();
        this._labelElement.remove();
        this.remove(this._label);
    }
}
