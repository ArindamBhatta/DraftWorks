import type { Config } from "../config";
import type { I18nKeys } from "../i18n";

/**
 * The Config flags the function-key row toggles. Narrowed to exactly the boolean drafting
 * aids so a typo in the table below is a compile error rather than a key that silently
 * does nothing.
 */
export type DraftingAidKey = Extract<
    keyof Config,
    | "enableSnap"
    | "enableGrid"
    | "enableGridSnap"
    | "enableOrtho"
    | "enablePolarTracking"
    | "enableSnapTracking"
    | "enableDynamicInput"
    | "showLineWeight"
    | "enableSelectionCycling"
>;

export interface FunctionKeyToggle {
    /** `KeyboardEvent.key`, which is "F8" and not a keyCode. */
    readonly key: string;
    readonly property: DraftingAidKey;
    /** Short name, shared with the status bar button so the two always agree. */
    readonly label: I18nKeys;
    /** The one-line explanation, shared with the status bar button's tooltip. */
    readonly description: I18nKeys;
}

/**
 * AutoCAD's function-key row, as far as this app has anything for the key to toggle.
 *
 * The numbers are AutoCAD's own and are not up for rearranging: the whole value of this
 * row is that it is already in the fingers of anyone arriving from AutoCAD, and a drafter
 * who hits F8 expecting ortho and gets a grid has been actively misled. That also decides
 * the two that look swappable - F10 is polar tracking and F11 is object snap tracking,
 * not the other way round.
 *
 * Absent, because there is nothing here for them to switch:
 *   F4  3D object snap    - this is a 2D drafting app
 *   F5  isoplane          - no isometric drafting mode
 *   F6  dynamic UCS       - the workplane is fixed
 *
 * F1 (this list itself) and F2 (the command history) are not in the table because they
 * toggle UI rather than a Config flag - see FunctionKeyService.
 *
 * Two more drafting aids have no function key in AutoCAD either, and so none here: LWT
 * (Lineweight display) and Selection Cycling, which AutoCAD puts on Ctrl+W - a chord no
 * browser will hand over. Both are in `StatusBarToggles` below, which is what the status
 * bar renders, so they get a button without pretending to a key they do not have.
 */
export const FunctionKeyToggles: readonly FunctionKeyToggle[] = [
    {
        key: "F3",
        property: "enableSnap",
        label: "statusBar.snap",
        description: "snap.osnapTip",
    },
    {
        key: "F7",
        property: "enableGrid",
        label: "snap.grid",
        description: "snap.gridTip",
    },
    {
        key: "F9",
        property: "enableGridSnap",
        label: "snap.snapMode",
        description: "snap.snapModeTip",
    },
    {
        key: "F8",
        property: "enableOrtho",
        label: "snap.ortho",
        description: "snap.orthoTip",
    },
    {
        key: "F10",
        property: "enablePolarTracking",
        label: "snap.polar",
        description: "snap.polarTip",
    },
    {
        key: "F11",
        property: "enableSnapTracking",
        label: "statusBar.tracking",
        description: "snap.trackingTip",
    },
    {
        key: "F12",
        property: "enableDynamicInput",
        label: "snap.dynamicInput",
        description: "snap.dynamicInputTip",
    },
];

/**
 * What the status bar shows, in the order AutoCAD's own status bar shows it: the drawing
 * aids that shape where a point lands, then the ones that change what you see or pick.
 *
 * A superset of FunctionKeyToggles - LWT and Selection Cycling have no function key, so
 * they appear here and not there. Deriving the row from one list rather than from the
 * order of calls in a render method is what keeps the buttons, their tooltips and their
 * keys describing the same set.
 */
export interface StatusBarToggle {
    readonly property: DraftingAidKey;
    readonly label: I18nKeys;
    readonly description: I18nKeys;
}

/** The two aids AutoCAD gives a status bar button but no function key. */
const KeylessToggles: readonly StatusBarToggle[] = [
    {
        property: "showLineWeight",
        label: "statusBar.lineWeight",
        description: "statusBar.lineWeightTip",
    },
    {
        property: "enableSelectionCycling",
        label: "statusBar.selectionCycling",
        description: "statusBar.selectionCyclingTip",
    },
];

const StatusBarOrder: readonly DraftingAidKey[] = [
    "enableGrid",
    "enableGridSnap",
    "enableOrtho",
    "enablePolarTracking",
    "enableSnap",
    "enableSnapTracking",
    "enableDynamicInput",
    "showLineWeight",
    "enableSelectionCycling",
];

export const StatusBarToggles: readonly StatusBarToggle[] = StatusBarOrder.map((property) => {
    const toggle = [...FunctionKeyToggles, ...KeylessToggles].find((t) => t.property === property);
    if (!toggle) throw new Error(`No toggle defined for ${property}`);
    return toggle;
});

/** The function key that toggles a given aid, for labelling its status bar button. */
export function functionKeyFor(property: DraftingAidKey): string | undefined {
    return FunctionKeyToggles.find((t) => t.property === property)?.key;
}
