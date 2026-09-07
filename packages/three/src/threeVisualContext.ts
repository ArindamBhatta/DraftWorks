import {
    BoundingBox,
    type CollectionChangedArgs,
    ComponentNode,
    DeepObserver,
    DimensionAnnotation,
    type EdgeMeshData,
    GeometryNode,
    GroupNode,
    type INode,
    type IShapeFilter,
    type IVisual,
    type IVisualContext,
    type IVisualObject,
    isDisposable,
    type Layer,
    type LineType,
    type Material,
    type Matrix4,
    MeshDataUtils,
    type MeshLike,
    MeshNode,
    type MeshOption,
    type NodeRecord,
    NodeUtils,
    RefSegmentAnnotation,
    type ShapeMeshData,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    TextAnnotation,
    Texture,
    VisualNode,
    XY,
    type XYZ,
} from "@chili3d/core";
import {
    Box3,
    BufferAttribute,
    BufferGeometry,
    Group,
    InstancedMesh,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    type MeshLambertMaterial,
    Object3D,
    Points,
    type Scene,
    type Material as ThreeMaterial,
    Vector3,
} from "three";
import { ThreeRefSegmentAnnotation } from "./threeAnnotation";
import { ThreeDimension } from "./threeDimension";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import { ThreeHelper } from "./threeHelper";
import { ThreeText } from "./threeText";
import { GroupVisualObject, ThreeComponentObject, ThreeMeshObject } from "./threeVisualObject";

export class ThreeVisualContext implements IVisualContext {
    private readonly _visualNodeMap = new Map<IVisualObject, INode>();
    private readonly _NodeVisualMap = new Map<INode, IVisualObject & Object3D>();
    readonly materialMap = new Map<string, ThreeMaterial>();

    readonly visualShapes: Group;
    readonly tempShapes: Group;
    readonly cssObjects: Group;

    constructor(
        readonly visual: IVisual,
        readonly scene: Scene,
    ) {
        this.visualShapes = new Group();
        this.tempShapes = new Group();
        this.cssObjects = new Group();
        scene.add(this.visualShapes, this.tempShapes, this.cssObjects);
        visual.document.modelManager.addNodeObserver(this.handleNodeChanged);
        visual.document.modelManager.materials.onCollectionChanged(this.onMaterialCollectionChanged);

        const layers = visual.document.modelManager.layers;
        layers.onCollectionChanged(this.onLayerCollectionChanged);
        layers.forEach((x) => x.onPropertyChanged(this.onLayerPropertyChanged));
    }

    private get modelManager() {
        return this.visual.document.modelManager;
    }

    private readonly onLayerCollectionChanged = (args: CollectionChangedArgs) => {
        if (args.action === "add") {
            args.items.forEach((x: Layer) => x.onPropertyChanged(this.onLayerPropertyChanged));
        } else if (args.action === "remove") {
            args.items.forEach((x: Layer) => x.removePropertyChanged(this.onLayerPropertyChanged));
        }
        this.refreshLayerStyling();
    };

    private readonly onLayerPropertyChanged = (property: keyof Layer) => {
        // Name changes nothing on screen, and neither does Plot/No Plot - that one is
        // about paper, so the drawing is deliberately left looking exactly the same.
        if (property !== "name" && property !== "printable") {
            this.refreshLayerStyling();
        }
    };

    /**
     * Re-applies every layer's colour, on/off state and lock to the objects on it.
     * Driven centrally rather than per-node subscriptions because a layer change affects
     * an arbitrary slice of the drawing, and layers change rarely.
     */
    refreshLayerStyling() {
        this._NodeVisualMap.forEach((visualObject, node) => {
            this.applyLayerStyling(node, visualObject);
        });
        this.visual.update();
    }

    private applyLayerStyling(node: INode, visualObject: IVisualObject & Object3D) {
        if (!(node instanceof VisualNode)) return;

        const layer = this.modelManager.layerOf(node);
        // Off and Frozen both hide; see Layer.frozen for why they are still separate.
        visualObject.visible = node.visible && node.parentVisible && layer.visible && !layer.frozen;
        visualObject.locked = layer.locked;
        if (visualObject instanceof ThreeGeometry) {
            visualObject.setLayerColor(layer.color);
            visualObject.setLineType(this.resolveLineType(node, layer));
            visualObject.setLineWeight(layer.lineWeight);
            visualObject.setTransparency(layer.transparency);
        }
    }

    /** An object drawn ByLayer takes the layer's linetype; otherwise its own wins. */
    private resolveLineType(node: VisualNode, layer: Layer): LineType {
        if (!(node instanceof GeometryNode)) return "solid";
        return node.lineType === "byLayer" ? layer.lineType : node.lineType;
    }

    /** Whether the node's layer currently allows it to be shown at all. */
    private layerVisible(node: INode): boolean {
        if (!(node instanceof VisualNode)) return true;
        return this.modelManager.layerOf(node).visible;
    }

    private readonly onMaterialCollectionChanged = (args: CollectionChangedArgs) => {
        if (args.action === "add") {
            args.items.forEach(this.createThreeMaterial.bind(this));
        } else if (args.action === "remove") {
            args.items.forEach(this.removeThreeMaterial.bind(this));
        }
    };

    private createThreeMaterial(material: Material) {
        const result = ThreeHelper.parseToThreeMaterial(material);
        DeepObserver.addDeepPropertyChangedHandler(material, this.onMaterialPropertyChanged);
        this.materialMap.set(material.id, result);
    }

    private removeThreeMaterial(item: Material) {
        const material = this.materialMap.get(item.id);
        this.materialMap.delete(item.id);
        DeepObserver.removeDeepPropertyChangedHandler(item, this.onMaterialPropertyChanged);
        material?.dispose();
    }

    private readonly onMaterialPropertyChanged = (path: string, source: any) => {
        const material: any = this.materialMap.get(source?.id);
        if (!material) return;

        const { isOk, value } = DeepObserver.getPathValue(source, path);
        if (!isOk) return;

        if (path === "color") {
            material.color.set(value);
        } else if (!path.includes(".")) {
            material[path] = value instanceof Texture ? ThreeHelper.loadTexture(value) : value;
        } else {
            this.setTextureValue(source, material, path, value);
        }
    };

    private setTextureValue(material: any, threeMaterial: any, path: string, value: any) {
        const paths = path.split(".");
        if (path.endsWith(".image") && material[paths[0]] instanceof Texture && paths[0] in threeMaterial) {
            threeMaterial[paths[0]] = ThreeHelper.loadTexture(material[paths[0]]);
            return;
        }

        let obj = threeMaterial;
        for (let i = 0; i < paths.length - 1; i++) {
            obj = obj[paths[i]];
        }
        if (obj === undefined) return;

        if (value instanceof XY) {
            obj[paths.at(-1)!].set(value.x, value.y);
        } else {
            obj[paths.at(-1)!] = value;
        }
    }

    readonly handleNodeChanged = (records: NodeRecord[]) => {
        const adds: INode[] = [];
        const rms: INode[] = [];
        records.forEach((x) => {
            if (x.action === "add" || x.action === "insertBefore" || x.action === "insertAfter") {
                NodeUtils.nodeOrChildrenAppendToNodes(adds, x.node);
            } else if (x.action === "remove" || x.action === "transfer") {
                NodeUtils.nodeOrChildrenAppendToNodes(rms, x.node);
            } else if (x.action === "move" && x.newParent) {
                this.moveNode(x.node, x.oldParent!);
            }
        });
        this.addNode(adds);
        this.removeNode(rms);
    };

    addVisualObject(object: IVisualObject): void {
        if (object instanceof Object3D) {
            this.visualShapes.add(object);
        }
    }

    removeVisualObject(object: IVisualObject): void {
        if (object instanceof Object3D) {
            this.visualShapes.remove(object);
        }
    }

    dispose() {
        this.visualShapes.traverse((x) => {
            if (isDisposable(x)) x.dispose();
        });
        this.visual.document.modelManager.materials.forEach((x) =>
            x.removePropertyChanged(this.onMaterialPropertyChanged),
        );
        this.visual.document.modelManager.materials.removeCollectionChanged(this.onMaterialCollectionChanged);
        this.visual.document.modelManager.removeNodeObserver(this.handleNodeChanged);
        this.materialMap.forEach((x) => x.dispose());
        this.materialMap.clear();
        this.visualShapes.clear();
        this.tempShapes.clear();
        this._visualNodeMap.clear();
        this._NodeVisualMap.clear();
        this.scene.remove(this.visualShapes, this.tempShapes);
    }

    getNode(visual: IVisualObject): INode | undefined {
        return this._visualNodeMap.get(visual);
    }

    redrawNode(models: INode[]) {
        this.removeNode(models);
        this.addNode(models);
    }

    get shapeCount() {
        return this.visualShapes.children.length;
    }

    getVisual(nodel: INode): IVisualObject | undefined {
        return this._NodeVisualMap.get(nodel);
    }

    visuals(): IVisualObject[] {
        const shapes: IVisualObject[] = [];
        this.visualShapes.children.forEach((x) => this._getVisualObject(shapes, x));
        return shapes;
    }

    boundingBoxIntersectFilter(
        boundingBox: {
            min: XYZ;
            max: XYZ;
        },
        filter?: IShapeFilter,
    ): IVisualObject[] {
        const box = new Box3().setFromPoints([
            ThreeHelper.fromXYZ(boundingBox.min),
            ThreeHelper.fromXYZ(boundingBox.max),
        ]);
        return this.visuals().filter((x) => {
            const node = (x as ThreeGeometry)?.geometryNode;
            const shape = (node as ShapeNode)?.shape?.unchecked();
            if (filter && shape && !filter.allow(shape, node.transform)) {
                return false;
            }

            // Not every visual is a ThreeGeometry (dimensions, texts, meshes and
            // components have no geometryNode), so take the world transform from the
            // visual itself - VisualNode.worldTransform() only delegates back here anyway.
            const localBox = x.boundingBox();
            if (localBox === undefined) {
                return false;
            }
            const boundingBox = BoundingBox.transformed(localBox, x.worldTransform());

            const testBox = new Box3(
                new Vector3(boundingBox.min.x, boundingBox.min.y, boundingBox.min.z),
                new Vector3(boundingBox.max.x, boundingBox.max.y, boundingBox.max.z),
            );
            return box.intersectsBox(testBox);
        });
    }

    private _getVisualObject(visuals: Array<IVisualObject>, obj: Object3D) {
        const group = obj as Group;
        if (group.type === "Group") {
            group.children.forEach((x) => this._getVisualObject(visuals, x));
        } else if (
            obj instanceof ThreeGeometry ||
            obj instanceof ThreeMeshObject ||
            obj instanceof ThreeComponentObject ||
            obj instanceof ThreeRefSegmentAnnotation ||
            obj instanceof ThreeDimension ||
            obj instanceof ThreeText
        ) {
            visuals.push(obj);
        }
    }

    displayMesh(datas: ShapeMeshData[], meshOption?: MeshOption): number {
        const group = new Group();
        datas.forEach((data) => {
            if (MeshDataUtils.isVertexMesh(data)) {
                group.add(ThreeGeometryFactory.createVertexGeometry(data, meshOption));
            } else if (MeshDataUtils.isEdgeMesh(data)) {
                group.add(ThreeGeometryFactory.createEdgeGeometry(data, meshOption));
            } else if (MeshDataUtils.isFaceMesh(data)) {
                group.add(ThreeGeometryFactory.createFaceGeometry(data, meshOption));
            }
        });
        this.tempShapes.add(group);
        return group.id;
    }

    setMeshColor(id: number, color: number): void {
        const group = this.tempShapes.getObjectById(id) as Group;
        if (!group) return;

        group.children.forEach((mesh: any) => {
            (mesh.material as MeshLambertMaterial).color.setHex(color);
        });
    }

    displayInstancedMesh(data: MeshLike, matrixs: Matrix4[], meshOption?: MeshOption): number {
        const geometry = ThreeGeometryFactory.createFaceBufferGeometry(data);
        const material = ThreeGeometryFactory.createMeshMaterial(meshOption);

        ThreeGeometryFactory.setColor(geometry, data, material);
        const instancedMesh = new InstancedMesh(geometry, material, matrixs.length);
        matrixs.forEach((matrix, index) => {
            instancedMesh.setMatrixAt(index, ThreeHelper.fromMatrix(matrix));
        });

        this.tempShapes.add(instancedMesh);
        return instancedMesh.id;
    }

    displayLineSegments(data: EdgeMeshData): number {
        const bufferGeometry = new BufferGeometry();
        bufferGeometry.setAttribute("position", new BufferAttribute(data.position, 3));
        const material = new LineBasicMaterial();
        const lineSegments = new LineSegments(bufferGeometry, material);
        ThreeGeometryFactory.setColor(bufferGeometry, data, material);

        this.tempShapes.add(lineSegments);
        return lineSegments.id;
    }

    setPosition(id: number, position: Float32Array): void {
        const shape = this.tempShapes.getObjectById(id);
        if (shape === undefined) return;

        if ("geometry" in shape && shape.geometry instanceof BufferGeometry) {
            shape.geometry.setAttribute("position", new BufferAttribute(position, 3));
            shape.geometry.attributes["position"].needsUpdate = true;
        }
    }

    setInstanceMatrix(id: number, matrixs: Matrix4[]) {
        const shape = this.tempShapes.getObjectById(id) as InstancedMesh;
        if (shape === undefined) return;
        matrixs.forEach((matrix, index) => {
            shape.setMatrixAt(index, ThreeHelper.fromMatrix(matrix));
        });
        shape.instanceMatrix.needsUpdate = true;
    }

    removeMesh(id: number) {
        const shape = this.tempShapes.getObjectById(id);
        if (shape === undefined) return;
        shape.children.forEach((x) => {
            if (x instanceof Mesh || x instanceof LineSegments || x instanceof Points) {
                x.geometry.dispose();
                x.material.dispose();
            }
            if (isDisposable(x)) {
                x.dispose();
            }
        });
        shape.children.length = 0;
        this.tempShapes.remove(shape);
    }

    setVisible(node: INode, visible: boolean): void {
        const shape = this.getVisual(node);
        if (shape === undefined) return;

        // A node on a switched-off layer stays hidden however its own flag is set.
        const resolved = visible && this.layerVisible(node);
        if (shape.visible === resolved) return;
        shape.visible = resolved;
    }

    moveNode(node: INode, oldParent: INode): void {
        if (oldParent === node.parent) return;

        const parentNode = this._NodeVisualMap.get(oldParent) ?? this.visualShapes;
        const newParentNode = (this._NodeVisualMap.get(node.parent!) as any) ?? this.visualShapes;
        if (parentNode === newParentNode) {
            return;
        }

        if (parentNode instanceof Group) {
            const visual = this._NodeVisualMap.get(node);
            if (visual instanceof Object3D) {
                parentNode.remove(visual);
                newParentNode.add(visual);
            }
        }
    }

    addNode(nodes: INode[]) {
        nodes.forEach((node) => {
            if (!this._NodeVisualMap.has(node)) {
                this.displayNode(node);
            }
        });
    }

    private displayNode(node: INode) {
        let visualObject: (IVisualObject & Object3D) | undefined;
        if (node instanceof MeshNode) {
            visualObject = new ThreeMeshObject(this, node);
        } else if (node instanceof GeometryNode) {
            visualObject = new ThreeGeometry(node, this);
        } else if (node instanceof GroupNode) {
            visualObject = new GroupVisualObject(node);
        } else if (node instanceof ComponentNode) {
            visualObject = new ThreeComponentObject(node, this);
        } else if (node instanceof RefSegmentAnnotation) {
            visualObject = new ThreeRefSegmentAnnotation(this, node);
        } else if (node instanceof DimensionAnnotation) {
            visualObject = new ThreeDimension(this, node);
        } else if (node instanceof TextAnnotation) {
            visualObject = new ThreeText(this, node);
        }

        if (visualObject) {
            const parent = this.getParentVisual(node);
            parent.add(visualObject);
            this._visualNodeMap.set(visualObject, node);
            this._NodeVisualMap.set(node, visualObject);
            this.applyLayerStyling(node, visualObject);
        }
    }

    removeNode(models: INode[]) {
        models.forEach((m) => {
            const visual = this._NodeVisualMap.get(m);
            this._NodeVisualMap.delete(m);
            if (!visual) return;
            this._visualNodeMap.delete(visual);
            visual.parent?.remove(visual);
            visual.dispose();
        });
    }

    private getParentVisual(node: INode): Group {
        let parent = this.visualShapes;
        if (node.parent) {
            const parentNode = this._NodeVisualMap.get(node.parent);
            if (parentNode instanceof Group) {
                parent = parentNode;
            }
        }
        return parent;
    }

    findShapes(shapeType: ShapeType): Object3D[] {
        if (shapeType === ShapeTypes.shape) {
            return [...this.visualShapes.children];
        }
        const shapes: Object3D[] = [];
        this.visualShapes.traverse((child) => {
            if (!(child instanceof ThreeGeometry)) return;

            if (shapeType === ShapeTypes.edge) {
                const wireframe = child.edges();
                if (wireframe) shapes.push(wireframe);
            } else if (shapeType === ShapeTypes.face) {
                const faces = child.faces();
                if (faces) shapes.push(faces);
            }
        });
        return shapes;
    }

    getMaterial(id: string | string[]): ThreeMaterial | ThreeMaterial[] {
        if (Array.isArray(id)) {
            const materials = [];
            for (const i of id) {
                const material = this.materialMap.get(i);
                if (!material) {
                    throw new Error(`Material not found: ${i}`);
                }
                materials.push(material);
            }
            return materials.length === 1 ? materials[0] : materials;
        }

        const material = this.materialMap.get(id);
        if (!material) {
            throw new Error(`Material not found: ${id}`);
        }
        return material;
    }
}
