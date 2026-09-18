import type { IDocument } from "../document";
import { DimensionSetup, Id } from "../foundation";
import type { I18nKeys } from "../i18n";
import { BoundingBox, XYZ } from "../math";
import { property } from "../property";
import { serializable, serialize } from "../serialize";
import { buildDimensionGeometry, type DimensionGeometry, type DimensionType } from "./dimensionGeometry";
import { layoutText, type TextLayout } from "./textLayout";
import { VisualNode } from "./visualNode";

export const AnnotationTypes = ["dimension", "text", "refInfiniteLine", "refSegment"] as const;
export type AnnotationType = (typeof AnnotationTypes)[number];

interface AnnotationOptionsBase {
    document: IDocument;
    annotationType: AnnotationType;
    name: string;
    id?: string;
    color?: number;
    visible?: boolean;
}

export interface DimensionAnnotationOptions extends AnnotationOptionsBase {
    annotationType: "dimension";
    dimensionType: DimensionType;
    /** Linear/aligned: first origin. Angular: the vertex. Radius/diameter: the centre. */
    startPoint: XYZ;
    /** Linear/aligned: second origin. Angular: a point on the first ray. */
    endPoint: XYZ;
    /** Angular only: a point on the second ray. */
    thirdPoint?: XYZ;
    /** Where the dimension line or leader was placed. */
    offsetPoint: XYZ;
    /** Radius/diameter only. */
    radius?: number;
    /** The drawing plane the dimension is laid out in. */
    normal: XYZ;
    xAxis: XYZ;
    /** The named dimension style this one is drawn in; omitted means the current style. */
    styleName?: string;
}

export interface TextAnnotationOptions extends AnnotationOptionsBase {
    annotationType: "text";
    content: string;
    /** Insertion point: left baseline for TEXT, top-left corner for MTEXT. */
    position: XYZ;
    /** Cap height in drawing units. Defaults to the dimension text height. */
    height?: number;
    /** Rotation about the plane normal, in degrees, counter-clockwise. */
    rotation?: number;
    /** Wrap width in drawing units. 0 is single-line TEXT; above 0 is MTEXT. */
    boxWidth?: number;
    /** The drawing plane the text is laid out in. Defaults to the world XY plane. */
    normal?: XYZ;
    xAxis?: XYZ;
}

export interface RefInfiniteLineAnnotationOptions extends AnnotationOptionsBase {
    annotationType: "refInfiniteLine";
    point: XYZ;
    direction: XYZ;
}

export interface RefSegmentAnnotationOptions extends AnnotationOptionsBase {
    annotationType: "refSegment";
    startPoint: XYZ;
    endPoint: XYZ;
}

export type AnnotationOptions =
    | DimensionAnnotationOptions
    | TextAnnotationOptions
    | RefInfiniteLineAnnotationOptions
    | RefSegmentAnnotationOptions;

export abstract class Annotation extends VisualNode {
    @serialize()
    readonly annotationType: AnnotationType;

    @serialize()
    get color(): number {
        return this.getPrivateValue("color", 0xffff00);
    }
    set color(value: number) {
        this.setProperty("color", value);
    }

    constructor(options: AnnotationOptionsBase) {
        super(options.document, options.name, options.id ?? Id.generate());
        this.annotationType = options.annotationType;
        if (options.color !== undefined) this.setPrivateValue("color", options.color);
        if (options.visible !== undefined) this.visible = options.visible;
    }

    override display(): I18nKeys {
        return "annotation";
    }
    override boundingBox(): BoundingBox | undefined {
        return undefined;
    }
}

/**
 * AutoCAD's TEXT and MTEXT in one node: a single-line label is just a text block that
 * never wraps, so the only thing separating them is `boxWidth`. Everything about how it
 * looks - the line breaks, the extents, the pick target - is derived from these fields
 * by layoutText rather than stored, so editing the content or the height in the
 * property panel restyles the object in place.
 *
 * `content`, `height`, `rotation` and `boxWidth` are @property as well as @serialize:
 * that is what puts them in the property panel, which is how text is edited after it is
 * placed (AutoCAD's DDEDIT).
 */
@serializable()
export class TextAnnotation extends Annotation {
    declare readonly annotationType: "text";

    @serialize()
    @property("annotation.text.content")
    get content(): string {
        return this.getPrivateValue("content");
    }
    set content(value: string) {
        this.setProperty("content", value);
    }

    @serialize()
    get position(): XYZ {
        return this.getPrivateValue("position");
    }
    set position(value: XYZ) {
        this.setProperty("position", value);
    }

    @serialize()
    @property("annotation.text.height", { type: "length" })
    get height(): number {
        return this.getPrivateValue("height", DimensionSetup.settings.textHeight);
    }
    set height(value: number) {
        this.setProperty("height", value);
    }

    @serialize()
    @property("annotation.text.rotation")
    get rotation(): number {
        return this.getPrivateValue("rotation", 0);
    }
    set rotation(value: number) {
        this.setProperty("rotation", value);
    }

    /** 0 for single-line TEXT; the picked box width for MTEXT. */
    @serialize()
    @property("annotation.text.width", { type: "length" })
    get boxWidth(): number {
        return this.getPrivateValue("boxWidth", 0);
    }
    set boxWidth(value: number) {
        this.setProperty("boxWidth", value);
    }

    @serialize()
    get normal(): XYZ {
        return this.getPrivateValue("normal", XYZ.unitZ);
    }
    set normal(value: XYZ) {
        this.setProperty("normal", value);
    }

    @serialize()
    get xAxis(): XYZ {
        return this.getPrivateValue("xAxis", XYZ.unitX);
    }
    set xAxis(value: XYZ) {
        this.setProperty("xAxis", value);
    }

    /** True for MTEXT: the block hangs from its top-left corner rather than a baseline. */
    get isMultiline(): boolean {
        return this.boxWidth > 0;
    }

    constructor(options: TextAnnotationOptions) {
        super(options);
        this.setPrivateValue("content", options.content);
        this.setPrivateValue("position", options.position);
        if (options.height !== undefined) this.setPrivateValue("height", options.height);
        if (options.rotation !== undefined) this.setPrivateValue("rotation", options.rotation);
        if (options.boxWidth !== undefined) this.setPrivateValue("boxWidth", options.boxWidth);
        if (options.normal !== undefined) this.setPrivateValue("normal", options.normal);
        if (options.xAxis !== undefined) this.setPrivateValue("xAxis", options.xAxis);
    }

    override display(): I18nKeys {
        return "annotation.text";
    }

    layout(): TextLayout {
        return layoutText(this.content, this.height, this.boxWidth);
    }

    /**
     * The block's extents in the drawing plane. Estimated from layoutText - see the note
     * there on why an exact width is only available once the DOM has laid the text out.
     */
    override boundingBox(): BoundingBox | undefined {
        const { width, height } = this.layout();
        const xDir = this.rotatedXAxis();
        const yDir = this.normal.cross(xDir).normalize();
        if (!yDir) return undefined;

        // TEXT sits on its baseline and grows up; MTEXT hangs from its top edge.
        const top = this.isMultiline ? this.position : this.position.add(yDir.multiply(height));
        return BoundingBox.fromPoints([
            top,
            top.add(xDir.multiply(width)),
            top.sub(yDir.multiply(height)),
            top.add(xDir.multiply(width)).sub(yDir.multiply(height)),
        ]);
    }

    /** The text's own X direction: the plane's X axis turned by `rotation`. */
    rotatedXAxis(): XYZ {
        const radians = (this.rotation * Math.PI) / 180;
        const x = this.xAxis.normalize() ?? XYZ.unitX;
        const y = this.normal.cross(x).normalize();
        if (!y) return x;
        return x.multiply(Math.cos(radians)).add(y.multiply(Math.sin(radians)));
    }
}

@serializable()
export class RefInfiniteLineAnnotation extends Annotation {
    declare readonly annotationType: "refInfiniteLine";

    @serialize()
    get point(): XYZ {
        return this.getPrivateValue("point");
    }
    set point(value: XYZ) {
        this.setProperty("point", value);
    }

    @serialize()
    get direction(): XYZ {
        return this.getPrivateValue("direction");
    }
    set direction(value: XYZ) {
        this.setProperty("direction", value);
    }

    constructor(options: RefInfiniteLineAnnotationOptions) {
        super(options);
        this.setPrivateValue("point", options.point);
        this.setPrivateValue("direction", options.direction);
    }
}

@serializable()
export class RefSegmentAnnotation extends Annotation {
    declare readonly annotationType: "refSegment";

    @serialize()
    get startPoint(): XYZ {
        return this.getPrivateValue("startPoint");
    }
    set startPoint(value: XYZ) {
        this.setProperty("startPoint", value);
    }

    @serialize()
    get endPoint(): XYZ {
        return this.getPrivateValue("endPoint");
    }
    set endPoint(value: XYZ) {
        this.setProperty("endPoint", value);
    }

    constructor(options: RefSegmentAnnotationOptions) {
        super(options);
        this.setPrivateValue("startPoint", options.startPoint);
        this.setPrivateValue("endPoint", options.endPoint);
    }

    override boundingBox(): BoundingBox | undefined {
        return BoundingBox.fromPoints([this.startPoint, this.endPoint]);
    }
}

/**
 * A real AutoCAD-style dimension: a persistent, serialized object in the drawing that
 * you can select and delete like any other node - not a floating label with a close
 * button. It stores only what was picked; the extension lines, dimension line,
 * arrowheads and label text are derived on demand by buildDimensionGeometry, so a
 * change to Dimension Setup (text height, arrow size, precision) restyles every
 * existing dimension rather than only the next one.
 */
@serializable()
export class DimensionAnnotation extends Annotation {
    declare readonly annotationType: "dimension";

    @serialize()
    readonly dimensionType: DimensionType;

    @serialize()
    get startPoint(): XYZ {
        return this.getPrivateValue("startPoint");
    }
    set startPoint(value: XYZ) {
        this.setProperty("startPoint", value);
    }

    @serialize()
    get endPoint(): XYZ {
        return this.getPrivateValue("endPoint");
    }
    set endPoint(value: XYZ) {
        this.setProperty("endPoint", value);
    }

    @serialize()
    get thirdPoint(): XYZ | undefined {
        return this.getPrivateValue("thirdPoint", undefined);
    }
    set thirdPoint(value: XYZ | undefined) {
        this.setProperty("thirdPoint", value);
    }

    @serialize()
    get offsetPoint(): XYZ {
        return this.getPrivateValue("offsetPoint");
    }
    set offsetPoint(value: XYZ) {
        this.setProperty("offsetPoint", value);
    }

    @serialize()
    get radius(): number {
        return this.getPrivateValue("radius", 0);
    }
    set radius(value: number) {
        this.setProperty("radius", value);
    }

    @serialize()
    get normal(): XYZ {
        return this.getPrivateValue("normal");
    }
    set normal(value: XYZ) {
        this.setProperty("normal", value);
    }

    @serialize()
    get xAxis(): XYZ {
        return this.getPrivateValue("xAxis");
    }
    set xAxis(value: XYZ) {
        this.setProperty("xAxis", value);
    }

    /**
     * The named style this dimension is drawn in, or undefined to follow whichever style
     * is current.
     *
     * Undefined is the normal state, not a missing value: a dimension drawn without ever
     * opening the style manager has no opinion about its style, and should follow the
     * drawing's. Only a dimension explicitly assigned a style carries a name - which is
     * also what makes the pre-style-table drawings migrate for free, since none of their
     * dimensions have one.
     */
    @serialize()
    get styleName(): string | undefined {
        return this.getPrivateValue("styleName", undefined);
    }
    set styleName(value: string | undefined) {
        this.setProperty("styleName", value);
    }

    constructor(options: DimensionAnnotationOptions) {
        super(options);
        this.dimensionType = options.dimensionType;
        this.setPrivateValue("styleName", options.styleName);
        this.setPrivateValue("startPoint", options.startPoint);
        this.setPrivateValue("endPoint", options.endPoint);
        this.setPrivateValue("thirdPoint", options.thirdPoint);
        this.setPrivateValue("offsetPoint", options.offsetPoint);
        this.setPrivateValue("radius", options.radius ?? 0);
        this.setPrivateValue("normal", options.normal);
        this.setPrivateValue("xAxis", options.xAxis);
    }

    override display(): I18nKeys {
        return "annotation.dimension";
    }

    geometry(): DimensionGeometry | undefined {
        return buildDimensionGeometry({
            type: this.dimensionType,
            start: this.startPoint,
            end: this.endPoint,
            third: this.thirdPoint,
            offsetPoint: this.offsetPoint,
            radius: this.radius,
            frame: { normal: this.normal, xAxis: this.xAxis },
            // Resolved here rather than left to the builder's own default, so a dimension
            // assigned a style is laid out in that style and not in whichever one happens
            // to be current. `styleFor` handles both the undefined and the deleted case.
            settings: DimensionSetup.styleFor(this.styleName),
        });
    }

    override boundingBox(): BoundingBox | undefined {
        const points = [this.startPoint, this.endPoint, this.offsetPoint];
        if (this.thirdPoint) points.push(this.thirdPoint);
        return BoundingBox.fromPoints(points);
    }
}
