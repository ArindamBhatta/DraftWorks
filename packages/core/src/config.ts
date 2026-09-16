import { ObjectStorage, Observable } from "./foundation";
import { I18n } from "./i18n";
import { MathUtils } from "./math";
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

    /**
     * What TRIM and EXTEND draw under the cursor, and why they are not the ordinary
     * highlight blue.
     *
     * Blue means "you could pick this", which is the one thing these previews do not
     * mean: they are the piece the click is about to take away or add, drawn over an
     * edge the cursor is already on. Red for the stretch that is about to stop existing
     * and green for the stretch about to start - the same green every other preview in
     * the app uses for geometry that is not there yet - so a glance at the colour
     * answers "what happens if I click" without reading anything.
     *
     * Wider than an ordinary edge, too, because the preview usually lies exactly on top
     * of the line it is describing and would otherwise be hidden by it.
     */
    trimPreviewColor = 0xff5555;
    extendPreviewColor = 0x33ff33;
    trimExtendPreviewLineWidth = 4;

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

/**
 * AutoCAD's TRIMEXTENDMODE, and the reason it is one variable rather than a setting on
 * each command: TRIM and EXTEND ask the same question - "what am I cutting/reaching to?"
 * - and a drafter who has decided how they want to be asked has decided it for both.
 *
 * Quick skips the boundary prompt and treats every object in the drawing as a boundary,
 * so TR/EX is two keystrokes and then clicking. Standard is the classic behaviour: name
 * the cutting or boundary edges first, Enter, and only those act. Enter with nothing
 * picked at that prompt is AutoCAD's <Select All>, which is what makes "TR Enter Enter"
 * the old muscle memory for "trim against everything".
 */
export const TrimExtendModes = ["quick", "standard"] as const;

export type TrimExtendMode = (typeof TrimExtendModes)[number];

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

    /**
     * AutoCAD's object snap tracking (F11): once a point has been acquired by hovering an
     * object snap, alignment paths run out from it, so a point can be placed "level with
     * that endpoint" without drawing a construction line. See ObjectTracking.
     *
     * Distinct from polar tracking below, which runs its paths from the point the command
     * is already measuring from rather than from an acquired one. AutoCAD keeps them on
     * separate keys because they answer different questions, and so does this.
     */
    @serialize()
    get enableSnapTracking() {
        return this.getPrivateValue("enableSnapTracking", true);
    }
    set enableSnapTracking(value: boolean) {
        this.setProperty("enableSnapTracking", value);
    }

    /**
     * AutoCAD's polar tracking (F10): alignment paths radiating from the command's
     * reference point at every multiple of each angle in `polarAngles`, with the cursor
     * snapping onto one when it comes near. See AxisTracking, which builds the rays.
     *
     * Where ORTHO *forces* the point onto the nearest axis, polar tracking only *offers*
     * the alignment - come off the path and the point is free again. Which is also why
     * the two cannot both be on: ortho leaves no cursor position at which a polar ray
     * could be offered, so the interlock in the setter turns the other off.
     */
    @serialize()
    get enablePolarTracking() {
        return this.getPrivateValue("enablePolarTracking", true);
    }
    set enablePolarTracking(value: boolean) {
        // The other half of the ORTHO / POLAR interlock - see enableOrtho.
        this.setProperty("enablePolarTracking", value, () => {
            if (value) this.enableOrtho = false;
        });
    }

    /**
     * The polar tracking increments, in degrees - AutoCAD's POLARANG, except that more
     * than one may be in force at a time. Rays are drawn at every multiple of every
     * increment listed, so `[90, 60]` offers the four axes *and* the sixths of a circle:
     * eight directions that no single increment produces.
     *
     * A list rather than one value because the useful combinations are exactly the ones
     * that do not divide each other. Where they do - [90, 45] - the finer increment
     * already covers the coarser and the union is simply the finer one, which is the
     * answer a drafter picking both would expect anyway.
     *
     * Sanitised on the way in rather than trusted: this drives `while (angle < 360)` in
     * AxisTracking, where a zero or negative step would not terminate, and a very small
     * one would carpet the view in rays all within snapping distance of each other. 5° is
     * the smallest AutoCAD offers in its list, but typed values down to 1° are allowed
     * there, so that is the floor here too. An empty list falls back to 90 - polar
     * tracking with no angles at all is a mode that cannot do anything.
     */
    @serialize()
    get polarAngles(): number[] {
        return this.getPrivateValue("polarAngles", [90]);
    }
    set polarAngles(value: number[]) {
        const cleaned = [
            ...new Set((value ?? []).filter(Number.isFinite).map((a) => MathUtils.clamp(a, 1, 90))),
        ].sort((a, b) => b - a);
        this.setProperty("polarAngles", cleaned.length > 0 ? cleaned : [90]);
    }

    /** AutoCAD's OSNAP (F3): the master switch over every object snap checked above. */
    @serialize()
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
    @serialize()
    get enableOrtho() {
        return this.getPrivateValue("enableOrtho", false);
    }
    set enableOrtho(value: boolean) {
        // ORTHO and POLAR are mutually exclusive, as they are in AutoCAD, and for the
        // same reason: ortho forces the point onto an axis, so while it is on there is no
        // cursor position at which a polar ray could ever be offered. Leaving both lit
        // would show a POLAR button that demonstrably does nothing.
        //
        // Only turning one ON turns the other off - switching one off leaves the other
        // alone, which is also what stops these two setters calling each other.
        this.setProperty("enableOrtho", value, () => {
            if (value) this.enablePolarTracking = false;
        });
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

    /**
     * AutoCAD's SNAPMODE (F9): the picked point is rounded to the nearest multiple of
     * `snapSpacing` on the workplane, so the cursor moves in steps rather than freely.
     * Off by default, as it is in AutoCAD. See GridSnap.
     *
     * Named "snap mode" rather than "grid snap" because it is not tied to the grid: the
     * grid here is adaptive - it re-picks a 1/2/5 decade spacing from the zoom, see
     * ThreeGrid - so there is no spacing on it to snap to. This has its own, which is
     * also how AutoCAD works, where SNAPUNIT and GRIDUNIT are separate variables.
     */
    @serialize()
    get enableGridSnap() {
        return this.getPrivateValue("enableGridSnap", false);
    }
    set enableGridSnap(value: boolean) {
        this.setProperty("enableGridSnap", value);
    }

    /**
     * AutoCAD's SNAPUNIT: the step SNAPMODE rounds to, in drawing units. Guarded against
     * zero and negatives, which would make the rounding divide by zero and put every
     * point at the origin.
     */
    @serialize()
    get snapSpacing() {
        return this.getPrivateValue("snapSpacing", 10);
    }
    set snapSpacing(value: number) {
        this.setProperty("snapSpacing", Number.isFinite(value) && value > 0 ? value : 10);
    }

    /**
     * AutoCAD's LWDISPLAY (the LWT button): whether an object's assigned Lineweight is
     * drawn at its real thickness, or everything is drawn thin.
     *
     * On by default, where AutoCAD has it off. AutoCAD's default is a holdover from
     * needing model space to redraw fast on hardware that no longer exists, and it has
     * the effect that setting a layer's Lineweight appears to do nothing at all until
     * you find the button. Here the weights are a layer property people set on purpose,
     * so they are shown by the same reasoning.
     */
    @serialize()
    get showLineWeight() {
        return this.getPrivateValue("showLineWeight", true);
    }
    set showLineWeight(value: boolean) {
        this.setProperty("showLineWeight", value);
    }

    /**
     * AutoCAD's SELECTIONCYCLING: when a click lands on more than one object, offer a
     * list of what is under the cursor instead of silently taking the topmost.
     *
     * AutoCAD puts this on Ctrl+W. A browser will not give that key up - it closes the
     * tab and `preventDefault` does not stop it - so the binding here is Ctrl+Shift+W.
     * Tab still steps through the candidates one at a time, which is the older way of
     * doing the same thing and is unaffected by this.
     */
    @serialize()
    get enableSelectionCycling() {
        return this.getPrivateValue("enableSelectionCycling", false);
    }
    set enableSelectionCycling(value: boolean) {
        this.setProperty("enableSelectionCycling", value);
    }

    @serialize()
    get language() {
        return this.getPrivateValue("language", I18n.defaultLanguage());
    }
    set language(value: string) {
        this.setProperty("language", value);
    }

    // Dark is the only theme the app offers - the picker that used to sit in the ribbon
    // title bar is gone, so nothing in the UI moves this off the default.
    @serialize()
    get themeMode() {
        return this.getPrivateValue("themeMode", "dark");
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

    /**
     * AutoCAD's TRIMEXTENDMODE - see TrimExtendModes. Quick by default, as it has been
     * in AutoCAD since 2021: it is the mode that makes the common case (trim this line
     * back to whatever it crosses) a click rather than a selection set.
     */
    @serialize()
    get trimExtendMode(): TrimExtendMode {
        return this.getPrivateValue("trimExtendMode", "quick");
    }
    set trimExtendMode(value: TrimExtendMode) {
        this.setProperty("trimExtendMode", value);
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
