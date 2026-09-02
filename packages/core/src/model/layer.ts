import type { IDocument } from "../document";
import { HistoryObservable, Id } from "../foundation";
import { serializable, serialize } from "../serialize";
import type { LineType } from "../shape";

/** The layer every drawing starts with. AutoCAD's layer 0 - it cannot be deleted. */
export const DEFAULT_LAYER_NAME = "0";

/**
 * Sentinel colour meaning "whatever the drawing's default edge colour is", so a layer
 * can follow the light/dark theme instead of pinning one colour that disappears against
 * one of the two backgrounds. Layer 0 uses this; user-created layers get a real colour.
 */
export const LAYER_COLOR_BY_THEME = -1;

/** Starting palette for new layers, roughly AutoCAD's first ACI colours. */
export const LAYER_PALETTE = [0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xff8000, 0x8000ff];

export interface LayerOptions {
    document: IDocument;
    name: string;
    id?: string;
    color?: number;
    visible?: boolean;
    locked?: boolean;
    printable?: boolean;
    frozen?: boolean;
    lineType?: LineType;
    lineWeight?: number;
    transparency?: number;
}

/** AutoCAD's lineweight steps, thinnest first, in the pixel widths this renderer draws. */
export const LAYER_LINE_WEIGHTS = [1, 2, 3, 4, 6];

/** AutoCAD caps transparency at 90% - a fully invisible layer would just be Off. */
export const MAX_LAYER_TRANSPARENCY = 90;

/**
 * An AutoCAD layer: a named group that owns the colour its objects draw in and whether
 * they are shown, selectable and plotted. Objects reference a layer by id (see
 * VisualNode.layerId) rather than being nested inside it, so a layer is orthogonal to
 * the model tree - a beam and the column next to it can sit anywhere in the tree and
 * still be turned off together.
 */
@serializable()
export class Layer extends HistoryObservable {
    @serialize()
    readonly id: string;

    @serialize()
    get name(): string {
        return this.getPrivateValue("name");
    }
    set name(value: string) {
        this.setProperty("name", value);
    }

    /** LAYER_COLOR_BY_THEME to follow the drawing default, otherwise a 0xRRGGBB value. */
    @serialize()
    get color(): number {
        return this.getPrivateValue("color", LAYER_COLOR_BY_THEME);
    }
    set color(value: number) {
        this.setProperty("color", value);
    }

    /** AutoCAD's layer On/Off. */
    @serialize()
    get visible(): boolean {
        return this.getPrivateValue("visible", true);
    }
    set visible(value: boolean) {
        this.setProperty("visible", value);
    }

    /** Locked layers stay visible but cannot be selected or edited. */
    @serialize()
    get locked(): boolean {
        return this.getPrivateValue("locked", false);
    }
    set locked(value: boolean) {
        this.setProperty("locked", value);
    }

    /** AutoCAD's Plot/No Plot: a no-plot layer still draws on screen but never prints. */
    @serialize()
    get printable(): boolean {
        return this.getPrivateValue("printable", true);
    }
    set printable(value: boolean) {
        this.setProperty("printable", value);
    }

    /**
     * AutoCAD's Freeze/Thaw. Frozen layers are hidden, like Off - the difference in
     * AutoCAD is that frozen geometry is also skipped during regeneration, which is why
     * freezing is the one you reach for on a huge drawing. This renderer has no
     * regeneration pass to skip, so the two look the same on screen and are kept apart
     * because drawings (and users) carry the distinction.
     */
    @serialize()
    get frozen(): boolean {
        return this.getPrivateValue("frozen", false);
    }
    set frozen(value: boolean) {
        this.setProperty("frozen", value);
    }

    /** The linetype objects on this layer draw with, unless they override it themselves. */
    @serialize()
    get lineType(): LineType {
        return this.getPrivateValue("lineType", "solid" as LineType);
    }
    set lineType(value: LineType) {
        this.setProperty("lineType", value);
    }

    /** AutoCAD's Lineweight, as the pixel width this renderer draws edges at. */
    @serialize()
    get lineWeight(): number {
        return this.getPrivateValue("lineWeight", 1);
    }
    set lineWeight(value: number) {
        this.setProperty("lineWeight", value);
    }

    /** Percent see-through: 0 is opaque, 90 the most AutoCAD allows. */
    @serialize()
    get transparency(): number {
        return this.getPrivateValue("transparency", 0);
    }
    set transparency(value: number) {
        this.setProperty("transparency", Math.min(Math.max(value, 0), MAX_LAYER_TRANSPARENCY));
    }

    get isDefault(): boolean {
        return this.name === DEFAULT_LAYER_NAME;
    }

    get usesThemeColor(): boolean {
        return this.color === LAYER_COLOR_BY_THEME;
    }

    // HistoryObservable, matching Material: recolouring or switching off a layer is an
    // edit to the drawing and belongs on the undo stack like any other.
    constructor(options: LayerOptions) {
        super(options.document);
        this.id = options.id ?? Id.generate();
        this.setPrivateValue("name", options.name);
        if (options.color !== undefined) this.setPrivateValue("color", options.color);
        if (options.visible !== undefined) this.setPrivateValue("visible", options.visible);
        if (options.locked !== undefined) this.setPrivateValue("locked", options.locked);
        if (options.printable !== undefined) this.setPrivateValue("printable", options.printable);
        if (options.frozen !== undefined) this.setPrivateValue("frozen", options.frozen);
        if (options.lineType !== undefined) this.setPrivateValue("lineType", options.lineType);
        if (options.lineWeight !== undefined) this.setPrivateValue("lineWeight", options.lineWeight);
        if (options.transparency !== undefined) this.setPrivateValue("transparency", options.transparency);
    }
}
