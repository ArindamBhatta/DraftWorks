import { VisualConfig } from "../config";
import type { IDocument } from "../document";
import { type IEqualityComparer, Logger, PubSub, Result } from "../foundation";
import { I18n, type I18nKeys } from "../i18n";
import { Matrix4 } from "../math";
import { property } from "../property";
import { serializable, serialize } from "../serialize";
import {
    type EdgeMeshData,
    type FaceMeshData,
    type IShape,
    type IShapeMeshData,
    ShapeTypeUtils,
    type VertexMeshData,
} from "../shape";
import { MeshUtils } from "../shape/meshUtils";
import { GeometryNode } from "./geometryNode";

const SHAPE_UNDEFINED = "Shape not initialized";

// ShapeNode is the seam where the OCCT/WASM kernel's fallible Result<IShape> enters
// the document model. Every operation the kernel performs (build a box, boolean two
// solids, fillet an edge) can fail on degenerate geometry, so a node's shape is
// always a Result, never a bare IShape - see setShape() below for how failures are
// handled without crashing the document, and foundation/result.ts for why Result
// exists instead of throwing.
export abstract class ShapeNode extends GeometryNode {
    protected _shape: Result<IShape> = Result.err(SHAPE_UNDEFINED);
    get shape(): Result<IShape> {
        return this._shape;
    }
    set shape(value: Result<IShape>) {
        this.setShape(value);
    }

    @property("common.shapeType")
    get shapeType(): string {
        if (!this._shape.isOk) {
            return this._shape.error;
        }

        return ShapeTypeUtils.stringValue(this._shape.value.shapeType);
    }

    protected setShape(shape: Result<IShape>) {
        // Skip the update if the newly computed shape is structurally identical to
        // what's already there (isEqual, not reference equality) - re-tessellating
        // and re-rendering a mesh is not free, and a no-op parameter edit (e.g.
        // setting dx to the value it already had) shouldn't trigger it.
        if (this._shape.isOk && this._shape.value.isEqual(shape.value)) {
            return;
        }

        // A failed shape (e.g. self-intersecting polygon, degenerate boolean) is
        // reported via PubSub instead of thrown. This node simply keeps its previous
        // (or "not initialized") shape rather than the document/undo stack having to
        // unwind because one body got a bad parameter - one broken feature shouldn't
        // crash editing everything else.
        if (!shape.isOk) {
            PubSub.default.pub("displayError", shape.error);
            return;
        }

        this._mesh = undefined;
        this.setProperty("shape", shape);
    }

    protected override createMesh(): IShapeMeshData {
        if (!this.shape.isOk) {
            Logger.warn(this.shape.error);
            return { edges: undefined, faces: undefined, vertexs: undefined };
        }
        const mesh = this.shape.value.mesh;
        this._originFaceMesh = mesh.faces;
        if (mesh.faces)
            mesh.faces = MeshUtils.mergeFaceMesh(
                mesh.faces,
                this.faceMaterialPair.map((x) => [x.faceIndex, x.materialIndex]),
            );
        return mesh;
    }

    override disposeInternal(): void {
        super.disposeInternal();
        this._shape.unchecked()?.dispose();
        this._shape = null as any;
    }
}

// MultiShapeMesh/MultiShapeNode intentionally bypass the Result<IShape>/generateShape
// machinery above: they exist for nodes that are a flat bag of already-built IShapes
// with no single parametric recipe behind them (e.g. an imported STEP assembly, or a
// combined display of several independent shapes). There's nothing to regenerate -
// the shapes are the source of truth, not derived from stored inputs - so this is a
// deliberately simpler sibling to ParameterShapeNode below, not a special case of it.
export class MultiShapeMesh implements IShapeMeshData {
    private readonly _vertexs: VertexMeshData;
    private readonly _edges: EdgeMeshData;
    private readonly _faces: FaceMeshData;

    get vertexs() {
        return this._vertexs.position.length > 0 ? this._vertexs : undefined;
    }

    get edges() {
        return this._edges.position.length > 0 ? this._edges : undefined;
    }

    get faces() {
        return this._faces.position.length > 0 ? this._faces : undefined;
    }

    constructor() {
        this._vertexs = {
            position: new Float32Array(),
            range: [],
            size: 0,
        };
        this._edges = {
            lineType: "solid",
            position: new Float32Array(),
            range: [],
            color: VisualConfig.defaultEdgeColor,
        };

        this._faces = {
            index: new Uint32Array(),
            normal: new Float32Array(),
            position: new Float32Array(),
            uv: new Float32Array(),
            range: [],
            groups: [],
            color: VisualConfig.defaultFaceColor,
        };
    }

    public addShape(shape: IShape, matrix: Matrix4) {
        const mesh = shape.mesh;
        const totleMatrix = shape.matrix.multiply(matrix);
        if (mesh.faces) {
            MeshUtils.combineFaceMeshData(this._faces, mesh.faces, totleMatrix);
        }
        if (mesh.edges) {
            MeshUtils.combineEdgeMeshData(this._edges, mesh.edges, totleMatrix);
        }
    }
}

export interface MultiShapeNodeOptions {
    document: IDocument;
    name: string;
    shapes: IShape[];
    materialId?: string;
    id?: string;
}

// The Node counterpart to MultiShapeMesh above - see the comment there for why this
// skips ParameterShapeNode's generate/regenerate contract entirely.
@serializable()
export class MultiShapeNode extends GeometryNode {
    private readonly _shapes: IShape[];
    @serialize()
    get shapes(): ReadonlyArray<IShape> {
        return this._shapes;
    }

    constructor(options: MultiShapeNodeOptions) {
        super({
            document: options.document,
            name: options.name,
            materialId: options.materialId,
            id: options.id,
        });
        this._shapes = options.shapes;
    }

    protected override createMesh(): IShapeMeshData {
        const meshes = new MultiShapeMesh();

        this._shapes.forEach((shape) => {
            meshes.addShape(shape, Matrix4.identity());
        });

        return meshes;
    }

    override display(): I18nKeys {
        return "body.multiShape";
    }
}

export interface ParameterShapeNodeOptions {
    document: IDocument;
    materialId?: string;
    id?: string;
}

// ParameterShapeNode is what makes Chili3D "parametric" rather than a plain shape
// viewer: the source of truth for a body (BoxNode, CircleNode, ...) is its numeric/
// geometric *inputs* (dx, dy, plane, center, radius...), not the OCCT shape they
// produce. The shape itself is a derived, lazily-computed cache - see the shape
// getter below, which only calls generateShape() once, the first time it's asked for
// (guarded by the SHAPE_UNDEFINED sentinel), and setPropertyEmitShapeChanged, which
// every concrete body's property setters funnel through so that editing a parameter
// (e.g. BoxNode.dx = 20) transparently invalidates and recomputes the shape. Without
// this layer, "parametric editing" would mean every body hand-rolling its own
// invalidate-and-regenerate logic.
export abstract class ParameterShapeNode extends ShapeNode {
    override get shape(): Result<IShape> {
        if (!this._shape.isOk && this._shape.error === SHAPE_UNDEFINED) {
            this._shape = this.generateShape();
        }
        return this._shape;
    }
    override set shape(value: Result<IShape>) {
        this.setShape(value);
    }

    // The hook every body's property setters call instead of setProperty() directly.
    // setProperty() alone only updates the stored value and notifies observers/undo;
    // this wraps it so that when the property actually changes, the shape is also
    // regenerated from the new inputs - this one line is why "change a body's
    // parameter" and "the 3D shape updates" are the same action from the caller's
    // perspective.
    protected setPropertyEmitShapeChanged<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]> | undefined,
    ): boolean {
        if (this.setProperty(property, newValue, onPropertyChanged, equals)) {
            this.setShape(this.generateShape());
            return true;
        }

        return false;
    }

    constructor(options: ParameterShapeNodeOptions) {
        super({
            document: options.document,
            name: undefined as any,
            materialId: options.materialId,
            id: options.id,
        });
        this.setPrivateValue("name", I18n.translate(this.display()));
    }

    // The single method every concrete body (BoxNode, CircleNode, ExtrudeNode, ...)
    // must implement: the point where a body's stored numeric/geometric parameters
    // turn into an actual OCCT shape, via a call out to the global `shapeFactory`
    // (see core/src/shape/shapeFactory.ts). Everything above this class is generic
    // caching/invalidation plumbing; this is the one body-specific line of "what do
    // I actually build."
    protected abstract generateShape(): Result<IShape>;
}

export interface EditableShapeNodeOptions {
    document: IDocument;
    name: string;
    shape: IShape | Result<IShape>;
    materialId?: string | string[];
    id?: string;
}

// The escape hatch counterpart to ParameterShapeNode: for shapes that have no
// parametric recipe to regenerate from - imported geometry, or the result of an
// edit/boolean operation applied directly to a shape - the IShape itself, not a set
// of inputs, is the source of truth. Setting .shape here just replaces it outright;
// there's no generateShape() to call back into.
@serializable()
export class EditableShapeNode extends ShapeNode {
    override display(): I18nKeys {
        return "body.editableShape";
    }

    @serialize()
    override get shape() {
        return this._shape;
    }

    override set shape(shape: Result<IShape>) {
        this.setShape(shape);
    }

    constructor(options: EditableShapeNodeOptions) {
        super(options);
        this._shape = options.shape instanceof Result ? options.shape : Result.ok(options.shape);
    }
}
