import type { CommandKeys, CommandPreset } from "../command";
import type { I18nKeys } from "../i18n";

export type ButtonSize = "large" | "small";

export interface PushButton {
    type: "push";
    command: CommandKeys;
    display?: I18nKeys;
    icon: string;
    size: ButtonSize;
    onClick: () => void;
}

/**
 * One of a command's drawing methods, as a flyout entry.
 *
 * AutoCAD's Circle flyout lists six entries - Center-Radius, Center-Diameter, 2-Point,
 * 3-Point and the two tangent methods - which are one command, CIRCLE, started on
 * different settings. This says exactly that: run `command` with `preset` applied, under
 * this entry's own name and icon. The preset's properties are then shown locked in the
 * command panel, because choosing the entry is how the user answered them.
 *
 * `disabled` is for a method the command does not implement yet. It stays in the list,
 * greyed, so the menu has the shape a user coming from AutoCAD expects rather than
 * quietly missing two rows - and so it is obvious what is coming rather than absent.
 */
export interface CommandMethod {
    type: "method";
    command: CommandKeys;
    display: I18nKeys;
    icon: string;
    preset?: CommandPreset;
    disabled?: boolean;
}

/** What a flyout or pulldown can list. */
export type MenuItem = PushButton | CommandMethod | CommandKeys;

export interface PulldownButton {
    type: "pulldown";
    display: I18nKeys;
    icon: string;
    items: MenuItem[];
}

export interface SplitButton {
    type: "split";
    items: MenuItem[];
    /**
     * The button face, for a flyout whose entries are methods of one tool rather than
     * different tools.
     *
     * The face is then the generic tool - tapping it says "a circle", with no method
     * chosen, so the command runs unpresetted and every setting in its panel stays
     * editable. Choosing from the menu is the opposite: the user has named the method
     * they want, so that entry's preset applies and those settings show locked.
     *
     * The distinction is what the two ways in mean. "Circle" is a request for a circle;
     * "Center, Diameter" is a request for that circle in particular. A flyout of genuinely
     * different tools (Rectangle / Regular Polygon) has no generic form to offer and so
     * omits this, and its face follows the last pick instead.
     */
    primary?: CommandMethod;
}

/** The live controls a ribbon group can hold. */
export type RibbonWidgetKind = "layerControl" | "layersPanel" | "autosaveStatus";

/**
 * A live control in a ribbon group rather than a button.
 *
 * AutoCAD's Layers panel is mostly not buttons: the layer combo shows the current
 * layer's on/lock/colour state and edits it in place, so there is no command to run
 * and nothing a PushButton could express. The control is named here rather than
 * passed in as an element so a ribbon profile stays declarative data - packages/ui
 * decides what to actually build from the name.
 */
export interface RibbonWidget {
    type: "widget";
    widget: RibbonWidgetKind;
}
