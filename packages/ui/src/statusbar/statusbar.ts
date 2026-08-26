// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CommandStore,
    I18n,
    type I18nKeys,
    type ICommand,
    Localize,
    PubSub,
    type StepOption,
} from "@chili3d/core";
import { button, div, label, span } from "@chili3d/element";
import { SnapConfig } from "./snapConfig";
import style from "./statusbar.module.css";

export class Statusbar extends HTMLElement {
    /** `CIRCLE` - the running command, the way AutoCAD heads each prompt. */
    readonly commandName = span({ className: style.commandName, textContent: "" });

    readonly tip = label({
        textContent: "",
        className: style.tip,
    });

    /**
     * AutoCAD's bracketed prompt alternatives - `or [3P/2P]` - with every key
     * clickable. Clicking one does exactly what typing it does, because both run the
     * same StepOption.onSelect (see core/src/snap/snap.ts): one pipeline, two ways in.
     */
    readonly options = div({ className: style.options });

    constructor(className: string) {
        super();
        this.className = `${style.panel} ${className}`;

        this.setDefaultTip();
        this.render();

        PubSub.default.sub("statusBarTip", this.statusBarTip);
        PubSub.default.sub("clearStatusBarTip", this.setDefaultTip);
        PubSub.default.sub("showStepOptions", this.showStepOptions);
        PubSub.default.sub("clearStepOptions", this.clearStepOptions);
        PubSub.default.sub("openCommandContext", this.showCommandName);
        PubSub.default.sub("closeCommandContext", this.clearCommandName);
    }

    private render() {
        this.append(
            div({ className: style.left }, this.commandName, this.tip, this.options),
            div({ className: style.right }, new SnapConfig()),
        );
    }

    private readonly statusBarTip = (tip: I18nKeys) => {
        I18n.set(this.tip, "textContent", tip);
    };

    // Navigation is fixed now that the view cannot orbit, so the idle tip is a
    // constant instead of being rebuilt from the old "3D Navigation" profile.
    private readonly setDefaultTip = () => {
        I18n.set(this.tip, "textContent", "prompt.default{0}", "Middle");
    };

    private readonly showCommandName = (command: ICommand) => {
        const data = CommandStore.getComandData(command);
        if (!data) return;
        this.commandName.textContent = I18n.translate(`command.${data.key}` as I18nKeys).toUpperCase();
    };

    private readonly clearCommandName = () => {
        this.commandName.textContent = "";
    };

    private readonly showStepOptions = (options: StepOption[]) => {
        if (options.length === 0) {
            this.clearStepOptions();
            return;
        }

        // "or [3P/2P]" - the separators are plain text so only the keys are clickable,
        // which is what makes the keys read as the thing you could have typed.
        const parts: (HTMLElement | Text)[] = [
            span({ className: style.optionsText, textContent: new Localize("prompt.or") }),
            span({ className: style.optionsBracket, textContent: "[" }),
        ];
        options.forEach((option, index) => {
            if (index > 0) {
                parts.push(span({ className: style.optionsBracket, textContent: "/" }));
            }
            parts.push(
                button(
                    {
                        className: style.option,
                        type: "button",
                        title: I18n.translate(option.display),
                        // The pick is still live behind this click - keep it that way.
                        onclick: (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            option.onSelect();
                        },
                    },
                    option.key,
                ),
            );
        });
        parts.push(span({ className: style.optionsBracket, textContent: "]:" }));

        this.options.replaceChildren(...parts);
    };

    private readonly clearStepOptions = () => {
        this.options.replaceChildren();
    };
}

customElements.define("chili-statusbar", Statusbar);
