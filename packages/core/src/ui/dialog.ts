import type { I18nKeys } from "../i18n";

export type DialogButton = {
    content: I18nKeys;
    shouldClose?: () => boolean;
    onclick?: () => void | Promise<void>;
};
