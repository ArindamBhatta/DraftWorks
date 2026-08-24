// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type I18nKeys, PubSub } from "@chili3d/core";
import { div, label } from "@chili3d/element";
import { SnapConfig } from "./snapConfig";
import style from "./statusbar.module.css";

export class Statusbar extends HTMLElement {
    readonly tip = label({
        textContent: "",
        className: style.tip,
    });

    constructor(className: string) {
        super();
        this.className = `${style.panel} ${className}`;

        this.setDefaultTip();
        this.render();

        PubSub.default.sub("statusBarTip", this.statusBarTip);
        PubSub.default.sub("clearStatusBarTip", this.setDefaultTip);
    }

    private render() {
        this.append(
            div({ className: style.left }, this.tip),
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
}

customElements.define("chili-statusbar", Statusbar);
