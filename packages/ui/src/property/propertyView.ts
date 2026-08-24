// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    FolderNode,
    GroupNode,
    type IDocument,
    type INode,
    type IView,
    Localize,
    Node,
    PropertyUtils,
    PubSub,
    VisualNode,
} from "@chili3d/core";
import { div, Expander, label } from "@chili3d/element";
import { CurrentLayerSelect } from "../layer";
import { propertyControl } from "./complexPropertyUtils";
import { MatrixProperty } from "./matrixProperty";
import style from "./propertyView.module.css";

/**
 * The contents of AutoCAD's properties palette: what is selected, and every value on it
 * that can be edited. It carries no title of its own - the palette hosting it has one.
 */
export class PropertyView extends HTMLElement {
    private readonly panel = div({ className: style.panel });

    constructor(props?: { className?: string }) {
        super();
        this.classList.add(style.root);
        if (props?.className) this.classList.add(props.className);
        this.append(this.panel);
        this.showProperties(undefined, []);
    }

    connectedCallback() {
        PubSub.default.sub("showProperties", this.showProperties);
        PubSub.default.sub("activeViewChanged", this.handleActiveViewChanged);
    }

    disconnectedCallback() {
        PubSub.default.remove("showProperties", this.showProperties);
        PubSub.default.remove("activeViewChanged", this.handleActiveViewChanged);
    }

    private readonly handleActiveViewChanged = (view: IView | undefined) => {
        if (view) {
            const nodes = view.document.selection.getSelectedNodes();
            this.showProperties(view.document, nodes);
        }
    };

    /** Re-renders on `nodes`; called on every selection change while the palette is up. */
    readonly showProperties = (document: IDocument | undefined, nodes: INode[]) => {
        this.removeProperties();
        if (!document) return;

        if (nodes.length === 0) {
            // Nothing picked: AutoCAD's Properties palette does not go blank here, it
            // falls back to what the next object drawn will use - which today is just
            // the current layer, so that is what shows, and it can be changed right here.
            this.panel.append(
                label({ className: style.empty, textContent: new Localize("properties.noSelection") }),
                new CurrentLayerSelect(document),
            );
            return;
        }
        this.addModel(document, nodes);
        this.addGeometry(nodes, document);
    };

    private removeProperties() {
        while (this.panel.lastElementChild) {
            this.panel.removeChild(this.panel.lastElementChild);
        }
    }

    private addModel(document: IDocument, nodes: INode[]) {
        if (nodes.length === 0) return;

        let controls: (HTMLElement | string)[] = [];
        if (nodes[0] instanceof FolderNode) {
            controls = PropertyUtils.getProperties(Object.getPrototypeOf(nodes[0])).map((x) =>
                propertyControl(document, nodes, x),
            );
        } else if (nodes[0] instanceof Node) {
            controls = PropertyUtils.getOwnProperties(Node.prototype).map((x) =>
                propertyControl(document, nodes, x),
            );
        }

        this.panel.append(div({ className: style.properties }, ...controls));
    }

    private addGeometry(nodes: INode[], document: IDocument) {
        const geometries = nodes.filter((x) => x instanceof VisualNode || x instanceof GroupNode);
        if (geometries.length === 0 || !this.isAllElementsOfTypeFirstElement(geometries)) return;
        this.addTransform(document, geometries);
        this.addParameters(geometries, document);
    }

    private addTransform(document: IDocument, geometries: (VisualNode | GroupNode)[]) {
        const matrix = new Expander("common.matrix");
        this.panel.append(matrix);

        matrix.contenxtPanel.append(new MatrixProperty(document, geometries, style.properties));
    }

    private addParameters(geometries: (VisualNode | GroupNode)[], document: IDocument) {
        const entities = geometries.filter((x) => x instanceof VisualNode);
        if (entities.length === 0 || !this.isAllElementsOfTypeFirstElement(entities)) return;
        const parameters = new Expander(entities[0].display());
        parameters.contenxtPanel.append(
            ...PropertyUtils.getProperties(Object.getPrototypeOf(entities[0]), Node.prototype).map((x) =>
                propertyControl(document, entities, x),
            ),
        );
        this.panel.append(parameters);
    }

    private isAllElementsOfTypeFirstElement(arr: any[]): boolean {
        if (arr.length <= 1) {
            return true;
        }
        const firstElementType = Object.getPrototypeOf(arr[0]).constructor;
        for (let i = 1; i < arr.length; i++) {
            if (Object.getPrototypeOf(arr[i]).constructor !== firstElementType) {
                return false;
            }
        }
        return true;
    }
}

customElements.define("chili-property-view", PropertyView);
