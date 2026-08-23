import type { I18nKeys } from "../i18n";

export const CommandPrefix = "command.";

export type CommandKeys = {
    [P in I18nKeys]: P extends `${typeof CommandPrefix}${infer K}` ? K : never;
}[I18nKeys];
