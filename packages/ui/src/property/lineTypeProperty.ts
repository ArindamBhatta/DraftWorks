// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    I18n,
    type I18nKeys,
    type IDocument,
    type LineType,
    Localize,
    type Property,
    Transaction,
} from "@draftworks/core";
import { div, label, option, select } from "@draftworks/element";
import commonStyle from "./common.module.css";
import { PropertyBase } from "./propertyBase";

/** In AutoCAD's own dropdown order: Continuous first, then the dashed patterns. */
const LINE_TYPES: { value: LineType; display: I18nKeys }[] = [
    { value: "byLayer", display: "lineType.byLayer" },
    { value: "solid", display: "lineType.solid" },
    { value: "dash", display: "lineType.dash" },
    { value: "hidden", display: "lineType.hidden" },
    { value: "dot", display: "lineType.dot" },
];

const MULTI_VALUE = "";

/** The Linetype dropdown in the properties palette - AutoCAD's Continuous/Dashed/etc. */
export class LineTypeProperty extends PropertyBase {
    readonly select: HTMLSelectElement;

    constructor(
        readonly document: IDocument,
        objects: any[],
        readonly property: Property,
    ) {
        super(objects);
        this.select = this.createSelect();
        this.append(
            div(
                { className: commonStyle.panel },
                label({
                    className: commonStyle.propertyName,
                    textContent: new Localize(this.property.display),
                }),
                this.select,
            ),
        );
    }

    private createSelect(): HTMLSelectElement {
        const current = this.currentValue();
        const options = LINE_TYPES.map((x) =>
            option({ value: x.value, textContent: I18n.translate(x.display), selected: x.value === current }),
        );
        if (current === MULTI_VALUE) {
            options.unshift(
                option({
                    value: MULTI_VALUE,
                    textContent: I18n.translate("properties.multivalue"),
                    selected: true,
                    hidden: true,
                }),
            );
        }

        return select({ className: commonStyle.select, onchange: this.setLineType }, ...options);
    }

    /** The shared line type across the selection, or "" if it varies. */
    private currentValue(): LineType | typeof MULTI_VALUE {
        const values = new Set(this.objects.map((x) => x[this.property.name] as LineType));
        return values.size === 1 ? values.values().next().value! : MULTI_VALUE;
    }

    private readonly setLineType = (e: Event) => {
        const value = (e.target as HTMLSelectElement).value as LineType;
        Transaction.execute(this.document, "change linetype", () => {
            this.objects.forEach((x) => {
                x[this.property.name] = value;
            });
        });
        this.document.visual.update();
    };
}

customElements.define("chili-linetype-property", LineTypeProperty);
