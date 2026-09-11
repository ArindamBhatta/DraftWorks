import {
    GeometryNode,
    GroupNode,
    I18n,
    type IDocument,
    type INode,
    type IView,
    Localize,
    Node,
    type Property,
    PropertyUtils,
    PubSub,
    VisualNode,
    XYZ,
} from "@chili3d/core";
import { div, label } from "@chili3d/element";
import { CurrentLayerSelect } from "../layer";
import { propertyControl } from "./complexPropertyUtils";
import { GeometryFactsView } from "./geometryFactsView";
import { LayerProperty } from "./layerProperty";
import { MatrixProperty } from "./matrixProperty";
import { AXES, PointAxisProperty } from "./pointAxisProperty";
import { PropertyCategory } from "./propertyCategory";
import style from "./propertyView.module.css";

/**
 * The contents of AutoCAD's properties palette: what is selected, and every value on it
 * that can be edited. It carries no title of its own - the palette hosting it has one.
 *
 * The palette is organised the way AutoCAD organises it, into General (which layer and
 * linetype the object draws with), Geometry (where it is and how big) and Misc, because
 * that grouping is what a draughtsman is scanning for. The two sections a CAD kernel
 * would naturally produce instead - "every property on the Node base class" and "every
 * property on this body subclass" - describe the code, not the drawing.
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

        this.panel.append(label({ className: style.selection, textContent: this.selectionLabel(nodes) }));
        this.addGeneral(document, nodes);

        // Everything past General describes one kind of object. A mixed selection has no
        // single Geometry to show - AutoCAD stops after General there too.
        if (!this.isAllElementsOfTypeFirstElement(nodes)) return;

        this.addGeometry(document, nodes);
        this.addMisc(document, nodes);
        this.addTransform(document, nodes);
    };

    private removeProperties() {
        while (this.panel.lastElementChild) {
            this.panel.removeChild(this.panel.lastElementChild);
        }
    }

    /**
     * AutoCAD's line above the categories: what is selected, and how many of it. A
     * mixed selection is "All", as it is there. Folders have no object type to name -
     * they are this app's own, not AutoCAD's - so a single one goes by its name.
     */
    private selectionLabel(nodes: INode[]): string {
        const first = nodes[0];
        const mixed = `${I18n.translate("properties.allSelected")} (${nodes.length})`;
        if (!this.isAllElementsOfTypeFirstElement(nodes)) return mixed;

        if (!(first instanceof VisualNode)) return nodes.length === 1 ? first.name : mixed;

        const type = I18n.translate(first.display());
        return nodes.length === 1 ? type : `${type} (${nodes.length})`;
    }

    /**
     * Layer, linetype and material - the settings that say how the object draws rather
     * than what shape it is, and the ones that apply to any selection however mixed.
     * Name is the app's own, not AutoCAD's, and is offered for a single object only:
     * one name typed across a whole selection would leave every object called the same
     * thing in the tree.
     */
    private addGeneral(document: IDocument, nodes: INode[]) {
        const category = new PropertyCategory("properties.group.general");
        const controls: (HTMLElement | string)[] = [];

        if (nodes.length === 1) {
            controls.push(...this.controlsFor(document, nodes, ["name"]));
        }
        if (nodes.every((x) => x instanceof VisualNode)) {
            controls.push(new LayerProperty(document, nodes as VisualNode[]));
        }
        controls.push(...this.controlsFor(document, nodes, ["lineType", "materialId"]));

        this.appendCategory(category, controls);
    }

    /**
     * Where the object is and how big, in the drawing's own coordinates. Point-valued
     * properties are broken into one row per axis - see PointAxisProperty - and the
     * measurements that follow from them are appended below as read-only rows.
     */
    private addGeometry(document: IDocument, nodes: INode[]) {
        const category = new PropertyCategory("properties.group.geometry");
        const controls: (HTMLElement | string)[] = [];
        // Both the per-axis rows and the measurements below them read through the
        // node's world transform, which only a VisualNode has.
        const visuals = nodes.every((x) => x instanceof VisualNode) ? (nodes as VisualNode[]) : undefined;

        for (const property of this.bodyProperties(nodes[0])) {
            if (visuals && visuals.every((x) => (x as any)[property.name] instanceof XYZ)) {
                controls.push(
                    ...AXES.map((axis) => new PointAxisProperty(document, visuals, property, axis)),
                );
            } else {
                controls.push(propertyControl(document, nodes, property));
            }
        }

        if (visuals) {
            const facts = new GeometryFactsView(visuals);
            if (!facts.isEmpty) controls.push(facts);
        }

        this.appendCategory(category, controls);
    }

    /** What is left: the shape's kind, whether it is capped into a face, and so on. */
    private addMisc(document: IDocument, nodes: INode[]) {
        const category = new PropertyCategory("properties.group.misc", false);
        this.appendCategory(category, this.controlsFor(document, nodes, MISC_PROPERTIES));
    }

    /**
     * Rotation and scale have no AutoCAD equivalent in the palette - there they are
     * consequences of ROTATE and SCALE - so this sits last and starts collapsed. It
     * stays because it is the only numeric way to rotate or scale an object, and
     * because a node with no editable geometry of its own (an imported mesh) has
     * nothing else here.
     */
    private addTransform(document: IDocument, nodes: INode[]) {
        const geometries = nodes.filter((x) => x instanceof VisualNode || x instanceof GroupNode);
        if (geometries.length === 0) return;

        const category = new PropertyCategory("properties.group.transform", false);
        category.content.append(new MatrixProperty(document, geometries, style.properties));
        this.panel.append(category);
    }

    private appendCategory(category: PropertyCategory, controls: (HTMLElement | string)[]) {
        const shown = controls.filter((x) => x !== "");
        if (shown.length === 0) return;

        category.content.append(...shown);
        this.panel.append(category);
    }

    /**
     * The named properties, in the order given, as editable rows. Every selected node
     * has to declare a property for it to appear: a mixed selection reaches General, and
     * a control built from the first node alone would happily write a linetype onto a
     * folder that has no such setting.
     */
    private controlsFor(document: IDocument, nodes: INode[], names: readonly string[]) {
        const declaredBy = (node: INode, name: string) =>
            PropertyUtils.getProperty(Object.getPrototypeOf(node), name as never);

        return names
            .map((name) => (nodes.every((x) => declaredBy(x, name)) ? declaredBy(nodes[0], name) : undefined))
            .filter((x): x is Property => x !== undefined)
            .map((property) => propertyControl(document, nodes, property));
    }

    /**
     * The properties this body declares for itself, minus the ones already placed in
     * another category. Walking only as far as GeometryNode keeps drawing settings
     * (material, linetype) out of Geometry; the filter catches what ShapeNode and
     * FacebaseNode contribute in between.
     */
    private bodyProperties(node: INode): Property[] {
        const until = node instanceof GeometryNode ? GeometryNode.prototype : Node.prototype;
        return PropertyUtils.getProperties(Object.getPrototypeOf(node), until).filter(
            (x) => !GENERAL_PROPERTIES.includes(x.name) && !MISC_PROPERTIES.includes(x.name),
        );
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

/** Placed under General by name, wherever in the class hierarchy they are declared. */
const GENERAL_PROPERTIES = ["name", "lineType", "materialId"];

/** Placed under Misc the same way - neither a drawing setting nor a measurement. */
const MISC_PROPERTIES = ["shapeType", "isFace"];

customElements.define("chili-property-view", PropertyView);
