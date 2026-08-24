// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, I18n, type I18nKeys, Localize } from "@chili3d/core";
import { type HTMLProps, option, select } from "@chili3d/element";

// Language/theme pickers used to live on the start-up Home screen. That screen is gone
// (the app now opens straight into the drawing editor), so they hang off the ribbon
// title bar instead - otherwise there would be no way to change either setting.
export const LanguageSelector = (props: HTMLProps<HTMLElement>) => {
    const languages: HTMLOptionElement[] = [];
    I18n.getLanguages().forEach((language) => {
        languages.push(
            option({
                selected: language.language === I18n.currentLanguage(),
                textContent: language.display,
            }),
        );
    });
    return select(
        {
            title: new Localize("common.language"),
            onchange: (e) => {
                const language = (e.target as HTMLSelectElement).selectedIndex;
                Config.instance.language = I18n.getLanguages()[language].language;
            },
            ...props,
        },
        ...languages,
    );
};

export const ThemeSelector = (props: HTMLProps<HTMLElement>) => {
    const themes = [
        { value: "light", key: "common.theme.light" },
        { value: "dark", key: "common.theme.dark" },
        { value: "system", key: "common.theme.system" },
    ];

    const themeOptions: HTMLOptionElement[] = [];
    themes.forEach((theme) =>
        themeOptions.push(
            option({
                selected: theme.value === Config.instance.themeMode,
                textContent: new Localize(theme.key as I18nKeys),
                value: theme.value,
            }),
        ),
    );
    return select(
        {
            title: new Localize("common.theme"),
            onchange: (e) => {
                const themeMode = (e.target as HTMLSelectElement).value as "light" | "dark" | "system";
                Config.instance.themeMode = themeMode;
            },
            ...props,
        },
        ...themeOptions,
    );
};
