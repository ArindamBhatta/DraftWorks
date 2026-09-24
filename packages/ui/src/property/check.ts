import { Binding, type IDocument, Localize, type Property, Transaction } from "@draftworks/core";
import { div, input, span } from "@draftworks/element";
import commonStyle from "./common.module.css";
import { PropertyBase } from "./propertyBase";

export class CheckProperty extends PropertyBase {
    constructor(
        readonly document: IDocument,
        objects: any[],
        readonly property: Property,
    ) {
        super(objects);
        this.appendChild(
            div(
                { className: commonStyle.panel },
                span({ className: commonStyle.propertyName, textContent: new Localize(property.display) }),
                input({
                    type: "checkbox",
                    checked: new Binding(objects[0], property.name),
                    onclick: () => {
                        const value = !objects[0][property.name];

                        Transaction.execute(document, "modify property", () => {
                            objects.forEach((x) => {
                                x[property.name] = value;
                            });
                            document.visual.update();
                        });
                    },
                }),
            ),
        );
    }
}

customElements.define("chili-check-property", CheckProperty);
