import { I18n } from "@draftworks/core";
import { div, label } from "@draftworks/element";
import { SnapConfig } from "./snapConfig";
import style from "./statusbar.module.css";

/**
 * The strip under the command window: how to work the view, and the snap settings.
 *
 * It used to head the running command's prompt as well - the name, the tip and the
 * bracketed options - which put half of every question here and the box you answer it in
 * somewhere else. All of that now lives on the command line's live line, where the
 * answering happens. What is left is the part that is true whatever is running.
 */
export class Statusbar extends HTMLElement {
    // Navigation is fixed now that the view cannot orbit, so the hint is a constant
    // instead of being rebuilt from the old "3D Navigation" profile.
    readonly tip = label({ className: style.tip });

    constructor(className: string) {
        super();
        this.className = `${style.panel} ${className}`;
        I18n.set(this.tip, "textContent", "prompt.default{0}", "Middle");

        this.append(
            div({ className: style.left }, this.tip),
            div({ className: style.right }, new SnapConfig()),
        );
    }
}

customElements.define("chili-statusbar", Statusbar);
