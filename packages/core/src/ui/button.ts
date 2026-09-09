import type { CommandKeys } from "../command";
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

export interface PulldownButton {
    type: "pulldown";
    display: I18nKeys;
    icon: string;
    items: (PushButton | CommandKeys)[];
}

export interface SplitButton {
    type: "split";
    items: (PushButton | CommandKeys)[];
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
