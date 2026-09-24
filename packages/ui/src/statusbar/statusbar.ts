import { I18n } from "@draftworks/core";
import { div, label, span } from "@draftworks/element";
import { SnapConfig } from "./snapConfig";
import style from "./statusbar.module.css";

/**
 * AutoCAD's CANNOSCALE readout, the "1:1" at the end of its status bar.
 *
 * A constant and a label, not a picker, because nothing here scales annotations yet: text
 * and dimensions are drawn at the height they are given, which is 1:1. A list of 1:50 and
 * 1:100 that changed nothing would be the MV Setup dialog again (see MvSetup) - a setting
 * that looks like it did something and did not. The scale a sheet is printed at is the
 * Plot dialog's, per plot. When annotative scaling exists, this is where its picker goes.
 */
const ANNOTATION_SCALE = "1:1";

/**
 * The strip under the command window: how to work the view, the snap settings, and the
 * annotation scale.
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

    readonly annotationScale = span({ className: style.scale, textContent: ANNOTATION_SCALE });

    constructor(className: string) {
        super();
        this.className = `${style.panel} ${className}`;
        I18n.set(this.tip, "textContent", "prompt.default{0}", "Middle");
        I18n.set(this.annotationScale, "title", "statusBar.annotationScaleTip");

        this.append(
            div({ className: style.left }, this.tip),
            div({ className: style.right }, new SnapConfig(), this.annotationScale),
        );
    }
}

customElements.define("chili-statusbar", Statusbar);
