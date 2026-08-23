import type { IDocument } from "../document";
import { HistoryObservable, Id } from "../foundation";
import { serializable, serialize } from "../serialize";

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
}

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

    @serialize()
    get printable(): boolean {
        return this.getPrivateValue("printable", true);
    }
    set printable(value: boolean) {
        this.setProperty("printable", value);
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
    }
}
