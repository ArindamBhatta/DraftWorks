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
    | "enableOrtho"
    | "enablePolarTracking"
    | "enableSnapTracking"
    | "enableDynamicInput"
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
 *   F9  snap mode         - grid *snap* needs a fixed grid spacing, and this app's grid
 *                           is adaptive by design (see ThreeGrid), so there is no
 *                           increment to snap to. It stays free for when there is.
 *
 * F1 (this list itself) and F2 (the command history) are not in the table because they
 * toggle UI rather than a Config flag - see FunctionKeyService.
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

/** The function key that toggles a given aid, for labelling its status bar button. */
export function functionKeyFor(property: FunctionKeyToggle["property"]): string | undefined {
    return FunctionKeyToggles.find((t) => t.property === property)?.key;
}
