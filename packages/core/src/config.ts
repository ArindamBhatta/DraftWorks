// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ObjectStorage, Observable } from "./foundation";
import { I18n } from "./i18n";
import { type SerializedData, Serializer, serialize } from "./serialize";
import { type ObjectSnapType, ObjectSnapTypes, ObjectSnapTypeUtils } from "./snapType";

export const DefaultLightEdgeColor = 0x333333;
export const DefaultDarkEdgeColor = 0xeeeeee;

export class VisualItemConfig extends Observable {
    defaultFaceColor = 0xdedede;
    /**
     * Selection feedback, kept deliberately light and deliberately blue.
     *
     * Light because the canvas is mid-grey in the light theme and near-black in the
     * dark one, so a pale colour is the one value that stands out against both.
     *
     * Blue because everything else that lights up while drawing - snap markers,
     * tracking lines, rubber-band previews, edit vertices - is the green below, and
     * when selection shared that green there was no way to tell "this is chosen" from
     * "this is where the cursor would land". Selection is the one cue that persists
     * after the mouse moves on, so it gets its own hue.
     *
     * Hover is the paler of the two ("you could pick this") and selection the stronger
     * ("you did pick this"). Both are drawn unlit - see materials.ts - because they are
     * cursor feedback, not surfaces: shading them made the colour set here come out
     * darker than it reads, which is what made the old green look muddy.
     */
    highlightEdgeColor = 0xbfe9ff;
    highlightFaceColor = 0xbfe9ff;
    selectedEdgeColor = 0x7fd4ff;
    selectedFaceColor = 0x7fd4ff;
    editVertexSize = 7;
    editVertexColor = 0x33ff33;
    hintVertexSize = 5;
    hintVertexColor = 0x33ff33;
    /**
     * AutoCAD's object-snap marker: the dot shown at every snappable key point of the
     * object under the cursor. Deliberately larger than the temporary point so "here is
     * where the magnet is" reads differently from "here is where you are".
     */
    snapMarkerSize = 9;
    snapMarkerColor = 0x33ff33;
    /**
     * Width and height of an object-snap marker glyph, in pixels - AutoCAD's
     * AUTOSNAPSIZE. Pixels rather than drawing units because the marker is a piece of
     * cursor feedback, not part of the drawing: it has to stay the same size however
     * far you zoom.
     */
    snapMarkerPixels = 12;
    snapMarkerLineWidth = 2;
    /**
     * The marker for the snap actually acquired, as against the ones merely on offer.
     * A different hue rather than a different size, so "this is the one you will get"
     * survives being read at a glance.
     */
    snapAcquiredColor = 0xffcc00;
    trackingVertexSize = 7;
    trackingVertexColor = 0x33ff33;
    temporaryVertexSize = 5;
    temporaryVertexColor = 0x33ff33;
    temporaryEdgeColor = 0x33ff33;

    get defaultEdgeColor() {
        return this.getPrivateValue("defaultEdgeColor", DefaultLightEdgeColor);
    }
    set defaultEdgeColor(value: number) {
        this.setProperty("defaultEdgeColor", value);
    }

    /**
     * AutoCAD's LTSCALE: a single multiplier over every dashed/hidden/dotted linetype's
     * dash and gap lengths. One knob rather than a per-object one, because a drawing
     * tends to be all one real-world scale, and AutoCAD users already reach for LTSCALE
     * first when a linetype comes in looking solid (too small a scale) or looks like a
     * dashed line stretched into occasional dots (too large).
     */
    get lineTypeScale() {
        return this.getPrivateValue("lineTypeScale", 1);
    }
    set lineTypeScale(value: number) {
        this.setProperty("lineTypeScale", value);
    }

    applyTheme(theme: "light" | "dark") {
        this.defaultEdgeColor = theme === "light" ? DefaultLightEdgeColor : DefaultDarkEdgeColor;
    }
}

export const VisualConfig = new VisualItemConfig();

export class Config extends Observable {
    static readonly #instance = new Config();

    static get instance() {
        return Config.#instance;
    }

    readonly SnapDistance: number = 10;

    get snapType() {
        return this.getPrivateValue(
            "snapType",
            ObjectSnapTypeUtils.combine(
                ObjectSnapTypes.midPoint,
                ObjectSnapTypes.endPoint,
                ObjectSnapTypes.center,
                ObjectSnapTypes.perpendicular,
                ObjectSnapTypes.intersection,
                ObjectSnapTypes.onCurve,
                ObjectSnapTypes.onSurface,
                ObjectSnapTypes.vertex,
                ObjectSnapTypes.tangent,
            ),
        );
    }
    set snapType(snapType: ObjectSnapType) {
        this.setProperty("snapType", snapType);
    }

    get enableSnapTracking() {
        return this.getPrivateValue("enableSnapTracking", true);
    }
    set enableSnapTracking(value: boolean) {
        this.setProperty("enableSnapTracking", value);
    }

    get enableSnap() {
        return this.getPrivateValue("enableSnap", true);
    }
    set enableSnap(value: boolean) {
        this.setProperty("enableSnap", value);
    }

    /**
     * AutoCAD-style ORTHO mode: while on, a picked point is locked to the workplane
     * axis running through the reference point, so every segment drawn comes out
     * horizontal or vertical. See OrthoSnap.
     */
    get enableOrtho() {
        return this.getPrivateValue("enableOrtho", false);
    }
    set enableOrtho(value: boolean) {
        this.setProperty("enableOrtho", value);
    }

    /**
     * AutoCAD's DYNMODE: while on, a point pick that has something to measure from
     * carries live distance and angle boxes at the cursor, and typing into them
     * constrains the point. On by default, as it is in AutoCAD. See dynamicInput.ts
     * for the maths and DynamicInput for the boxes themselves.
     */
    @serialize()
    get enableDynamicInput() {
        return this.getPrivateValue("enableDynamicInput", true);
    }
    set enableDynamicInput(value: boolean) {
        this.setProperty("enableDynamicInput", value);
    }

    /**
     * AutoCAD-style GRID mode: draws a reference grid across the drawing plane. The
     * spacing is not stored here because the grid is adaptive - it re-picks a 1/2/5
     * decade spacing from the current zoom so the lines never crowd together. See
     * ThreeGrid.
     */
    @serialize()
    get enableGrid() {
        return this.getPrivateValue("enableGrid", true);
    }
    set enableGrid(value: boolean) {
        this.setProperty("enableGrid", value);
    }

    @serialize()
    get language() {
        return this.getPrivateValue("language", I18n.defaultLanguage());
    }
    set language(value: string) {
        this.setProperty("language", value);
    }

    @serialize()
    get themeMode() {
        return this.getPrivateValue("themeMode", "system");
    }
    set themeMode(value: "light" | "dark" | "system") {
        this.setProperty("themeMode", value, () => this.applyTheme(value));
    }

    @serialize()
    get trustedDomains() {
        return this.getPrivateValue("trustedDomains", []);
    }
    set trustedDomains(value: string[]) {
        this.setProperty("trustedDomains", value);
    }

    #storageKey: string = "config";
    get storageKey() {
        return this.#storageKey;
    }

    private constructor() {
        super();
    }

    init(storageKey: string) {
        this.#storageKey = storageKey;
        this.readFromStorage();
        this.applyTheme(this.themeMode);
    }

    private readonly applyTheme = (value: "light" | "dark" | "system") => {
        if (value === "system") {
            VisualConfig.applyTheme(
                window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
            );
        } else {
            VisualConfig.applyTheme(value);
        }
    };

    readFromStorage() {
        const data = ObjectStorage.default.value<SerializedData>(this.storageKey);
        for (const key in data) {
            const thisKey = key as keyof Config;
            this.setPrivateValue(thisKey, (data as any)[key]);
        }
    }

    saveToStorage() {
        const json = Serializer.serializeProperties(this);
        ObjectStorage.default.setValue(this.storageKey, json);
    }
}
