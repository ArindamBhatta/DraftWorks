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
