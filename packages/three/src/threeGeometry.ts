import {
    type BoundingBox,
    type EdgeMeshData,
    type FaceMeshData,
    type GeometryNode,
    type IShape,
    type ISubShape,
    type IVisualGeometry,
    type LineType,
    type Matrix4,
    MeshUtils,
    type ShapeMeshRange,
    ShapeNode,
    type ShapeType,
    ShapeTypes,
    ShapeTypeUtils,
    type VertexMeshData,
} from "@draftworks/core";
import {
    type Material,
    Mesh,
    type MeshBasicMaterial,
    type MeshLambertMaterial,
    Points,
    type PointsMaterial,
} from "three";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { Constants } from "./constants";
import {
    defaultEdgeMaterial,
    defaultVertexMaterial,
    layerEdgeMaterial,
    lockFaceMaterial,
    lockLineMaterial,
} from "./materials";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import { ThreeHelper } from "./threeHelper";
import type { ThreeVisualContext } from "./threeVisualContext";
import { ThreeVisualObject } from "./threeVisualObject";

export class ThreeGeometry extends ThreeVisualObject implements IVisualGeometry {
    private _faceMaterial: Material | Material[];
    private _edges?: LineSegments2;
    private _faces?: Mesh;
    private _vertexs?: Points;

    constructor(
        readonly geometryNode: GeometryNode,
        readonly context: ThreeVisualContext,
    ) {
        super(geometryNode);
        this._faceMaterial = context.getMaterial(geometryNode.materialId);
        this.generateShape();
        geometryNode.onPropertyChanged(this.handleGeometryPropertyChanged);
    }

    changeFaceMaterial(material: Material | Material[]) {
        if (this._faces) {
            this._faceMaterial = material;
            this._faces.material = material;
        }
    }

    box() {
        return this._faces?.geometry.boundingBox ?? this._edges?.geometry.boundingBox;
    }

    override boundingBox(): BoundingBox | undefined {
        const box = this._faces?.geometry.boundingBox ?? this._edges?.geometry.boundingBox;
        if (!box) return undefined;

        return {
            min: ThreeHelper.toXYZ(box.min),
            max: ThreeHelper.toXYZ(box.max),
        };
    }

    // `lineType` is not handled here: "byLayer" has to be resolved against the node's
    // layer, which the visual context does - see ThreeVisualContext.onNodePropertyChanged.
    private readonly handleGeometryPropertyChanged = (property: keyof GeometryNode) => {
        if (property === "materialId") {
            this.changeFaceMaterial(this.context.getMaterial(this.geometryNode.materialId));
        } else if (property === "filled") {
            this.applyFaceLayer();
            this.context.visual.update();
        } else if ((property as keyof ShapeNode) === "shape") {
            this.removeMeshes();
            this.generateShape();
        }
    };

    private generateShape() {
        const mesh = this.geometryNode.mesh;
        if (mesh?.vertexs?.position.length) this.initVertexs(mesh.vertexs);
        if (mesh?.faces?.position.length) this.initFaces(mesh.faces);
        if (mesh?.edges?.position.length) this.initEdges(mesh.edges);
    }

    override dispose() {
        super.dispose();
        this.geometryNode.removePropertyChanged(this.handleGeometryPropertyChanged);
        this.removeMeshes();
    }

    private removeMeshes() {
        if (this._vertexs) {
            this.remove(this._vertexs);
            this._vertexs.geometry.dispose();
            this._vertexs = null as any;
        }
        if (this._edges) {
            this.remove(this._edges);
            this._edges.geometry.dispose();
            this._edges = null as any;
        }
        if (this._faces) {
            this.remove(this._faces);
            this._faces.geometry.dispose();
            this._faces = null as any;
        }
    }

    private initVertexs(data: VertexMeshData) {
        const buff = ThreeGeometryFactory.createVertexBufferGeometry(data);
        this._vertexs = new Points(buff, defaultVertexMaterial);
        this._vertexs.layers.set(Constants.Layers.Wireframe);
        this.add(this._vertexs);
    }

    // The material the edges return to after a highlight/selection clears. Tracks the
    // node's layer colour and linetype, so "unhighlight" does not reset a BEAM to the
    // default colour, or a fence drawn HIDDEN back to solid.
    private _baseEdgeMaterial: LineMaterial = defaultEdgeMaterial;
    private _layerColor: number = -1;
    private _lineType: LineType = "solid";
    private _lineWeight = 1;
    private _transparency = 0;

    /** Applies the colour of the layer this node belongs to. */
    setLayerColor(color: number) {
        this._layerColor = color;
        this.refreshBaseEdgeMaterial();
    }

    /** Applies the Linetype this node resolved to (Continuous/Dashed/Hidden/Dot). */
    setLineType(lineType: LineType) {
        this._lineType = lineType;
        this.refreshBaseEdgeMaterial();
    }

    /** The layer's Lineweight, as a pixel width. */
    setLineWeight(lineWeight: number) {
        this._lineWeight = lineWeight;
        this.refreshBaseEdgeMaterial();
    }

    /** The layer's Transparency, 0 (opaque) to 90 percent. */
    setTransparency(transparency: number) {
        this._transparency = transparency;
        this.refreshBaseEdgeMaterial();
    }

    private refreshBaseEdgeMaterial() {
        const material = layerEdgeMaterial(
            this._layerColor,
            this._lineType,
            this._lineWeight,
            this._transparency,
        );
        if (this._baseEdgeMaterial === material) return;

        const wasBase = this._edges?.material === this._baseEdgeMaterial;
        this._baseEdgeMaterial = material;
        // Only repaint if nothing temporary (highlight, selection, lock) is showing;
        // removeTemperaryMaterial will pick the new base up when that clears.
        if (this._edges && wasBase) this._edges.material = material;
    }

    private initEdges(data: EdgeMeshData) {
        const buff = ThreeGeometryFactory.createEdgeBufferGeometry(data);
        this._edges = new LineSegments2(buff, this._baseEdgeMaterial);
        this._edges.layers.set(Constants.Layers.Wireframe);
        // Dashed linetypes need the per-vertex distance-along-the-line attribute this
        // computes; harmless to compute it up front even for a solid line, since the
        // node's Linetype can be switched to a dashed one later without rebuilding the
        // geometry.
        this._edges.computeLineDistances();
        this.add(this._edges);
    }

    private initFaces(data: FaceMeshData) {
        const buff = ThreeGeometryFactory.createFaceBufferGeometry(data);
        if (data.groups.length > 1) buff.groups = data.groups;
        this._faces = new Mesh(buff, this._faceMaterial);
        this.applyFaceLayer();
        this.add(this._faces);
    }

    /**
     * Fills go on the Fill layer, which every view mode draws; everything else stays on
     * Solid, which the 2D wireframe mode switches off. This is the whole of "a circle is
     * a ring until you hatch it".
     */
    private applyFaceLayer() {
        this._faces?.layers.set(this.geometryNode.filled ? Constants.Layers.Fill : Constants.Layers.Solid);
    }

    /**
     * Widened from MeshLambertMaterial because the selection and highlight overlays
     * are unlit (MeshBasicMaterial) - they are cursor feedback rather than surfaces,
     * so they must render at exactly the colour VisualConfig gives them.
     */
    setFacesMateiralTemperary(material: MeshLambertMaterial | MeshBasicMaterial) {
        if (this._faces) this._faces.material = material;
    }

    setEdgesMateiralTemperary(material: LineMaterial) {
        if (this._edges) this._edges.material = material;
    }

    setVertexsMateiralTemperary(material: PointsMaterial) {
        if (this._vertexs) this._vertexs.material = material;
    }

    removeTemperaryMaterial(): void {
        if (this._vertexs) this._vertexs.material = defaultVertexMaterial;
        if (this._edges && this._edges.material !== lockLineMaterial)
            this._edges.material = this._baseEdgeMaterial;
        if (this._faces && this._faces.material !== lockFaceMaterial)
            this._faces.material = this._faceMaterial;
    }

    cloneSubEdge(index: number) {
        const positions = MeshUtils.subEdge(this.geometryNode.mesh.edges!, index);
        if (!positions) return undefined;

        const buff = new LineSegmentsGeometry();
        buff.setPositions(positions);
        buff.applyMatrix4(this.matrixWorld);

        return new LineSegments2(buff, defaultEdgeMaterial);
    }

    cloneSubFace(index: number) {
        const mesh = MeshUtils.subFace(this.geometryNode.mesh.faces!, index);
        if (!mesh) return undefined;

        const buff = ThreeGeometryFactory.createFaceBufferGeometry(mesh);
        buff.applyMatrix4(this.matrixWorld);

        return new Mesh(buff, this._faceMaterial);
    }

    faces() {
        return this._faces;
    }

    edges() {
        return this._edges;
    }

    vertexs() {
        return this._vertexs;
    }

    override getSubShapeAndIndex(shapeType: "face" | "edge" | "vertex", subVisualIndex: number) {
        let subShape: ISubShape | undefined;
        let transform: Matrix4 | undefined;
        let index: number = -1;
        let groups: ShapeMeshRange[] | undefined;
        if (shapeType === "vertex") {
            groups = this.geometryNode.mesh.vertexs?.range;
            if (groups) {
                index = ThreeHelper.findGroupIndex(groups, subVisualIndex)!;
                subShape = groups[index].shape;
                transform = groups[index].transform;
            }
        } else if (shapeType === "edge") {
            groups = this.geometryNode.mesh.edges?.range;
            if (groups) {
                index = ThreeHelper.findGroupIndex(groups, subVisualIndex)!;
                subShape = groups[index].shape;
                transform = groups[index].transform;
            }
        } else {
            groups = this.geometryNode.mesh.faces?.range;
            if (groups) {
                index = ThreeHelper.findGroupIndex(groups, subVisualIndex)!;
                subShape = groups[index].shape;
                transform = groups[index].transform;
            }
        }

        let shape: IShape | undefined = subShape;
        if (this.geometryNode instanceof ShapeNode) {
            shape = this.geometryNode.shape.value;
        }
        return { transform, shape, subShape, index, groups: groups ?? [] };
    }

    override subShapeVisual(shapeType: ShapeType): (Mesh | LineSegments2 | Points)[] {
        const shapes: (Mesh | LineSegments2 | Points | undefined)[] = [];

        const isWhole =
            shapeType === ShapeTypes.shape ||
            ShapeTypeUtils.hasCompound(shapeType) ||
            ShapeTypeUtils.hasCompoundSolid(shapeType) ||
            ShapeTypeUtils.hasSolid(shapeType);

        if (isWhole || ShapeTypeUtils.hasVertex(shapeType)) {
            shapes.push(this.vertexs());
        }

        if (isWhole || ShapeTypeUtils.hasEdge(shapeType) || ShapeTypeUtils.hasWire(shapeType)) {
            shapes.push(this.edges());
        }

        if (isWhole || ShapeTypeUtils.hasFace(shapeType) || ShapeTypeUtils.hasShell(shapeType)) {
            shapes.push(this.faces());
        }

        return shapes.filter((x) => x !== undefined);
    }

    override wholeVisual(): (Mesh | LineSegments2 | Points)[] {
        return [this.edges(), this.faces(), this.vertexs()].filter((x) => x !== undefined);
    }
}
