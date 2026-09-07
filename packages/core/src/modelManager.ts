import type { IDocument } from "./document";
import {
    type CollectionChangedArgs,
    NodeLinkedListHistoryRecord,
    type NodeRecord,
    Observable,
    ObservableCollection,
    Transaction,
} from "./foundation";
import type { Material } from "./material";
import type { Component } from "./model/component";
import { FolderNode } from "./model/folderNode";
import { DEFAULT_LAYER_NAME, LAYER_PALETTE, Layer } from "./model/layer";
import { type INode, type INodeLinkedList, NodeUtils } from "./model/node";
import { type Serialized, Serializer } from "./serialize";

export type OnNodeChanged = (records: NodeRecord[]) => void;

export class ModelManager extends Observable {
    private readonly _nodeChangedObservers = new Set<OnNodeChanged>();

    readonly components: ObservableCollection<Component> = new ObservableCollection();
    readonly materials: ObservableCollection<Material> = new ObservableCollection();

    /**
     * The drawing's layers. Every drawing has layer "0" (see ensureDefaultLayer), and
     * new objects land on `currentLayer` - AutoCAD's model, where you set a layer
     * current and then draw on it, rather than drawing first and filing afterwards.
     */
    readonly layers: ObservableCollection<Layer> = new ObservableCollection();

    private _rootNode: INodeLinkedList | undefined;
    get rootNode(): INodeLinkedList {
        if (this._rootNode === undefined) {
            this._rootNode = this.initRootNode();
        }
        return this._rootNode;
    }
    set rootNode(value: INodeLinkedList) {
        if (this._rootNode === value) return;

        this._rootNode?.removePropertyChanged(this.handleRootNodeNameChanged);
        this._rootNode = value ?? new FolderNode({ document: this.document, name: this.document.name });
        this._rootNode.onPropertyChanged(this.handleRootNodeNameChanged);
    }

    private _currentNode?: INodeLinkedList;
    get currentNode(): INodeLinkedList | undefined {
        return this._currentNode;
    }
    set currentNode(value: INodeLinkedList | undefined) {
        this.setProperty("currentNode", value);
    }

    /**
     * Id of the layer new objects are created on. Falls back to layer "0" whenever the
     * stored id no longer resolves - deleting the current layer must not leave the
     * drawing without one.
     */
    get currentLayerId(): string {
        const id = this.getPrivateValue("currentLayerId", "");
        if (id && this.layers.find((x) => x.id === id)) return id;
        return this.ensureDefaultLayer().id;
    }
    set currentLayerId(value: string) {
        this.setProperty("currentLayerId", value);
    }

    get currentLayer(): Layer {
        const id = this.currentLayerId;
        return this.layers.find((x) => x.id === id) ?? this.ensureDefaultLayer();
    }

    constructor(readonly document: IDocument) {
        super();
        this.materials.onCollectionChanged(this.handleMaterialChanged);
        this.components.onCollectionChanged(this.handleComponentChanged);
        this.layers.onCollectionChanged(this.handleLayerChanged);
        this.ensureDefaultLayer();
    }

    /**
     * Layer "0" exists in every drawing; creates it on first use. Deliberately not
     * recorded in history - it is an invariant, not an edit, and undoing into a drawing
     * with no layer 0 would leave every object pointing at a layer that is not there.
     */
    ensureDefaultLayer(): Layer {
        const existing = this.layers.find((x) => x.name === DEFAULT_LAYER_NAME);
        if (existing) return existing;

        const layer = new Layer({ document: this.document, name: DEFAULT_LAYER_NAME });
        this._suppressLayerHistory = true;
        try {
            this.layers.push(layer);
        } finally {
            this._suppressLayerHistory = false;
        }
        return layer;
    }

    layerById(id: string | undefined): Layer | undefined {
        if (!id) return undefined;
        return this.layers.find((x) => x.id === id);
    }

    /** The layer a node draws on, falling back to layer "0" for an unset/stale id. */
    layerOf(node: { layerId?: string }): Layer {
        return this.layerById(node.layerId) ?? this.ensureDefaultLayer();
    }

    /** Adds a layer with a unique name and the next unused palette colour. */
    addLayer(name?: string): Layer {
        const layer = new Layer({
            document: this.document,
            name: this.uniqueLayerName(name),
            color: LAYER_PALETTE[this.layers.length % LAYER_PALETTE.length],
        });
        this.layers.push(layer);
        return layer;
    }

    private uniqueLayerName(preferred?: string): string {
        const base = preferred?.trim() || "Layer1";
        if (!this.layers.find((x) => x.name === base)) return base;

        for (let i = 1; ; i++) {
            const candidate = `${base}${i}`;
            if (!this.layers.find((x) => x.name === candidate)) return candidate;
        }
    }

    /**
     * Refuses to delete layer "0" or a layer that still has objects on it, the way
     * AutoCAD does - silently re-homing someone's beams would be worse than saying no.
     */
    canRemoveLayer(layer: Layer): { ok: true } | { ok: false; reason: "default" | "inUse" } {
        if (layer.isDefault) return { ok: false, reason: "default" };
        if (this.findNode((node) => (node as any).layerId === layer.id)) {
            return { ok: false, reason: "inUse" };
        }
        return { ok: true };
    }

    removeLayer(layer: Layer): boolean {
        if (!this.canRemoveLayer(layer).ok) return false;

        const wasCurrent = this.currentLayerId === layer.id;
        this.layers.remove(layer);
        if (wasCurrent) this.currentLayerId = this.ensureDefaultLayer().id;
        return true;
    }

    private readonly handleRootNodeNameChanged = (prop: string) => {
        if (prop === "name") {
            this.document.name = this.rootNode.name;
        }
    };

    initRootNode() {
        return new FolderNode({ document: this.document, name: this.document.name });
    }

    addNodeObserver(observer: OnNodeChanged) {
        this._nodeChangedObservers.add(observer);
    }

    removeNodeObserver(observer: OnNodeChanged) {
        this._nodeChangedObservers.delete(observer);
    }

    notifyNodeChanged(records: NodeRecord[]) {
        Transaction.add(this.document, new NodeLinkedListHistoryRecord(records));
        this._nodeChangedObservers.forEach((x) => {
            x(records);
        });
    }

    addNode(...nodes: INode[]): void {
        (this.currentNode ?? this.rootNode).add(...nodes);
    }

    findNode(predicate: (value: INode) => boolean) {
        if (!this._rootNode) return undefined;

        return NodeUtils.findNode(this._rootNode, predicate);
    }

    findNodes(predicate?: (value: INode) => boolean) {
        if (!this._rootNode) return [];

        return NodeUtils.findNodes(this._rootNode, predicate);
    }

    serialize() {
        return {
            components: this.components.map((x) => Serializer.serializeObject(x)),
            nodes: NodeUtils.serializeNode(this.rootNode),
            materials: this.materials.map((x) => Serializer.serializeObject(x)),
            layers: this.layers.map((x) => Serializer.serializeObject(x)),
            currentLayerId: this.currentLayerId,
        };
    }

    async deserialize(data: {
        components: Serialized[];
        nodes: Serialized[];
        materials: Serialized[];
        layers?: Serialized[];
        currentLayerId?: string;
    }) {
        // Layers first: nodes resolve their colour and visibility through them as their
        // visuals are created during node deserialization.
        if (data.layers?.length) {
            this.layers.clear();
            this.layers.push(...data.layers.map((x) => Serializer.deserializeObject(this.document, x)));
        }
        this.ensureDefaultLayer();
        if (data.currentLayerId) this.setPrivateValue("currentLayerId", data.currentLayerId);

        this.components.push(
            ...data.components.map((x: Serialized) => Serializer.deserializeObject(this.document, x)),
        );

        this.materials.push(
            ...data.materials.map((x: Serialized) => Serializer.deserializeObject(this.document, x)),
        );

        const rootNode = await NodeUtils.deserializeNode(this.document, data.nodes);
        this.rootNode = rootNode!;
    }

    override disposeInternal(): void {
        super.disposeInternal();
        this._nodeChangedObservers.clear();
        this.materials.removeCollectionChanged(this.handleMaterialChanged);
        this.components.removeCollectionChanged(this.handleComponentChanged);
        this.layers.removeCollectionChanged(this.handleLayerChanged);
        this._rootNode?.removePropertyChanged(this.handleRootNodeNameChanged);
        this._rootNode?.dispose();
        this.materials.forEach((x) => x.dispose());
        this.materials.clear();
        this.layers.forEach((x) => x.dispose());
        this.layers.clear();
        this._rootNode = undefined;
        this._currentNode = undefined;
    }

    private readonly handleMaterialChanged = (args: CollectionChangedArgs) => {
        if (args.action === "add") {
            Transaction.add(this.document, {
                name: "MaterialChanged",
                dispose() {},
                undo: () => this.materials.remove(...args.items),
                redo: () => this.materials.push(...args.items),
            });
        } else if (args.action === "remove") {
            Transaction.add(this.document, {
                name: "MaterialChanged",
                dispose() {},
                undo: () => this.materials.push(...args.items),
                redo: () => this.materials.remove(...args.items),
            });
        }
    };

    private _suppressLayerHistory = false;

    private readonly handleLayerChanged = (args: CollectionChangedArgs) => {
        if (this._suppressLayerHistory) return;

        if (args.action === "add") {
            Transaction.add(this.document, {
                name: "LayerChanged",
                dispose() {},
                undo: () => this.layers.remove(...args.items),
                redo: () => this.layers.push(...args.items),
            });
        } else if (args.action === "remove") {
            Transaction.add(this.document, {
                name: "LayerChanged",
                dispose() {},
                undo: () => this.layers.push(...args.items),
                redo: () => this.layers.remove(...args.items),
            });
        }
    };

    private readonly handleComponentChanged = (args: CollectionChangedArgs) => {
        if (args.action === "add") {
            Transaction.add(this.document, {
                name: "ComponentChanged",
                dispose() {},
                undo: () => this.components.remove(...args.items),
                redo: () => this.components.push(...args.items),
            });
        } else if (args.action === "remove") {
            Transaction.add(this.document, {
                name: "ComponentChanged",
                dispose() {},
                undo: () => this.components.push(...args.items),
                redo: () => this.components.remove(...args.items),
            });
        }
    };
}
