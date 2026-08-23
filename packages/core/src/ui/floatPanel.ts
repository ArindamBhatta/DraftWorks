import type { I18nKeys } from "../i18n/keys";

export interface FloatPanelOptions {
    title: I18nKeys;
    content: HTMLElement;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    x?: number;
    y?: number;
    onClose?: () => void;
}
