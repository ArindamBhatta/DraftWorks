import { type I18nKeys, Localize } from "@draftworks/core";
import { div, label, setSVGIcon, svg } from "@draftworks/element";
import style from "./propertyCategory.module.css";

/**
 * One banded, collapsible section of the Properties palette - General, Geometry, Misc.
 *
 * Deliberately not the shared Expander: that draws a rounded, inset card, which is right
 * where it is used but wrong here. AutoCAD's palette is a single table whose category
 * headers are full-width bands, so the rows below them all line up in one column, and a
 * card per category would break the column the eye follows down the values.
 */
export class PropertyCategory extends HTMLElement {
    readonly content = div({ className: style.content });
    private readonly icon: SVGSVGElement;
    private expanded: boolean;

    constructor(header: I18nKeys, expanded = true) {
        super();
        this.expanded = expanded;
        this.className = style.category;
        this.icon = svg({ icon: this.iconName(), className: style.icon });
        this.append(
            div(
                { className: style.header, onclick: this.toggle },
                this.icon,
                label({ className: style.headerText, textContent: new Localize(header) }),
            ),
            this.content,
        );
        this.content.classList.toggle(style.hidden, !expanded);
    }

    private iconName() {
        return this.expanded ? "icon-angle-down" : "icon-angle-right";
    }

    private readonly toggle = (e: MouseEvent) => {
        e.stopPropagation();
        this.expanded = !this.expanded;
        setSVGIcon(this.icon, this.iconName());
        this.content.classList.toggle(style.hidden, !this.expanded);
    };
}

customElements.define("chili-property-category", PropertyCategory);
