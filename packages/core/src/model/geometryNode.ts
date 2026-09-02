import type { IDocument } from "../document";
import { Id, PropertyHistoryRecord, Transaction } from "../foundation";
import { BoundingBox } from "../math";
import { property } from "../property";
import { serializable, serialize } from "../serialize";
import type { FaceMeshData, IShapeMeshData, LineType } from "../shape";
import { MeshUtils } from "../shape/meshUtils";
import { VisualNode } from "./visualNode";

export interface FaceMaterialPairOptions {
    faceIndex: number;
    materialIndex: number;
}

@serializable()
export class FaceMaterialPair {
    @serialize()
    faceIndex: number;

    @serialize()
    materialIndex: number;
    constructor(options: FaceMaterialPairOptions) {
        this.faceIndex = options.faceIndex;
        this.materialIndex = options.materialIndex;
    }
}

export interface GeometryNodeOptions {
    document: IDocument;
    name: string;
    materialId?: string | string[];
    id?: string;
}

// GeometryNode is where materials and a renderable mesh enter the hierarchy - it's
// deliberately a separate layer from ShapeNode below because "how this is colored/
// faced and what triangles get sent to the renderer" is a different concern from
// "how the underlying OCCT shape is produced." createMesh() is abstract here (not
// in ShapeNode) because the mesh source genuinely differs per subclass: ShapeNode
// tessellates a single OCCT IShape, MultiShapeNode combines a flat array of them,
// and other GeometryNode subclasses (e.g. imported raw meshes) may have no IShape
// at all.
export abstract class GeometryNode extends VisualNode {
    @serialize()
    @property("common.material", { type: "materialId" })
    get materialId(): string | string[] {
        return this.getPrivateValue("materialId");
    }
    set materialId(value: string | string[]) {
        this.setProperty("materialId", value);
    }

    // AutoCAD's per-object Linetype. The default is ByLayer - the object follows whatever
    // its layer is set to - and any other value is an override that wins over the layer;
    // ThreeVisualContext.resolveLineType is where the two meet. Display-only: it never
    // touches the mesh, so switching it needs no retessellation, just a different edge
    // material downstream.
    @serialize()
    @property("common.lineType", { type: "lineType" })
    get lineType(): LineType {
        return this.getPrivateValue("lineType", "byLayer" as LineType);
    }
    set lineType(value: LineType) {
        this.setProperty("lineType", value);
    }

    /**
     * Whether this node's face is painted, or drawn only as its outline.
     *
     * A 2D drawing is outlines by default - a circle in AutoCAD is a ring, not a disc,
     * and every shape this app draws with "as face" on would look wrong filled. Fills
     * are the exception, and they are deliberate: a HATCH. So face geometry exists on
     * every such node but is only rendered when something has asked for it, which is
     * what this flag records. Display-only, like lineType: the mesh is unchanged either
     * way, only the layer it is drawn on.
     */
    @serialize()
    get filled(): boolean {
        return this.getPrivateValue("filled", false);
    }
    set filled(value: boolean) {
        this.setProperty("filled", value);
    }

    protected _originFaceMesh?: FaceMeshData;

    // A single node can have more than one color/material across its faces (think a
    // box with a different color per side). Rather than splitting that box into six
    // separate face nodes just to color them independently, each face keeps its
    // original index into the tessellated mesh and gets an override material index
    // via this list - one shape, many face materials, without changing the topology.
    @serialize()
    get faceMaterialPair(): FaceMaterialPair[] {
        return this.getPrivateValue("faceMaterialPair", []);
    }
    set faceMaterialPair(value: FaceMaterialPair[]) {
        const oldMaterisl = Array.isArray(this.materialId) ? [...this.materialId] : this.materialId;
        const Face = [...this.faceMaterialPair];
        this.setProperty("faceMaterialPair", value, () => this.updateVisual(oldMaterisl, Face));
    }

    constructor(options: GeometryNodeOptions) {
        super(options.document, options.name, options.id ?? Id.generate());
        this.setPrivateValue(
            "materialId",
            options.materialId ?? options.document.modelManager.materials.at(0)?.id ?? "",
        );
    }

    protected _mesh: IShapeMeshData | undefined;
    get mesh(): IShapeMeshData {
        this._mesh ??= this.createMesh();
        return this._mesh as any;
    }

    override boundingBox(): BoundingBox | undefined {
        let points = this.mesh.faces?.position;
        if (!points || points.length === 0) {
            points = this.mesh.edges?.position;
        }

        if (!points || points.length === 0) {
            return undefined;
        }
        return BoundingBox.fromNumbers(this.transform.ofPoints(points));
    }

    override disposeInternal(): void {
        super.disposeInternal();
        this._mesh = undefined;
    }

    private copyOldValue() {
        const oldMaterial = Array.isArray(this.materialId) ? [...this.materialId] : this.materialId;
        const oldFacePair = [...this.faceMaterialPair];
        return {
            oldFacePair,
            oldMaterial,
        };
    }

    addFaceMaterial(pairs: { faceIndex: number; materialId: string }[]) {
        const { oldFacePair, oldMaterial } = this.copyOldValue();
        pairs.forEach(({ faceIndex, materialId }) => {
            if (this.materialId === materialId) {
                return;
            }

            if (this._mesh?.faces?.range.length === 1) {
                this.setPrivateValue("materialId", materialId);
                return;
            }

            if (typeof this.materialId === "string") {
                this.setPrivateValue("materialId", [this.materialId, materialId]);
            }

            const index = this.materialId.indexOf(materialId);
            if (index === -1) {
                (this.materialId as string[]).push(materialId);
                this.faceMaterialPair.push(
                    new FaceMaterialPair({ faceIndex, materialIndex: this.materialId.length - 1 }),
                );
            } else {
                this.faceMaterialPair.push(new FaceMaterialPair({ faceIndex, materialIndex: index }));
            }
        });
        this.updateVisual(oldMaterial, oldFacePair);
    }

    removeFaceMaterial(faceIndexs: number[]) {
        const { oldFacePair, oldMaterial } = this.copyOldValue();
        const toDelete = this.faceMaterialPair.filter((x) => faceIndexs.includes(x.faceIndex));
        this.setPrivateValue(
            "faceMaterialPair",
            this.faceMaterialPair.filter((x) => !faceIndexs.includes(x.faceIndex)),
        );
        toDelete.forEach((pair) => {
            const hasSameMaterial = this.faceMaterialPair.some((x) => x.materialIndex === pair.materialIndex);
            if (hasSameMaterial || !Array.isArray(this.materialId)) {
                return;
            }
            this.materialId.splice(pair.materialIndex, 1);
            if (this.materialId.length === 1) {
                this.setPrivateValue("materialId", this.materialId[0]);
            } else if (this.materialId.length > 1) {
                this.faceMaterialPair.forEach((x) => {
                    if (x.materialIndex > pair.materialIndex) {
                        x.materialIndex--;
                    }
                });
            }
        });

        this.updateVisual(oldMaterial, oldFacePair);
    }

    clearFaceMaterial() {
        const { oldFacePair, oldMaterial } = this.copyOldValue();

        if (Array.isArray(this.materialId)) {
            this.setPrivateValue("materialId", this.materialId[0]);
        }
        this.setPrivateValue("faceMaterialPair", []);

        this.updateVisual(oldMaterial, oldFacePair);
    }

    private readonly updateVisual = (oldMaterisl: string | string[], oldFacePair: FaceMaterialPair[]) => {
        if (!this._originFaceMesh) return;
        if (this.faceMaterialPair.length === 0) {
            this._mesh!.faces = this._originFaceMesh;
        } else {
            this._mesh!.faces = MeshUtils.mergeFaceMesh(
                this._originFaceMesh,
                this.faceMaterialPair.map((x) => [x.faceIndex, x.materialIndex] as [number, number]),
            );
            if (this._mesh!.faces.groups.length === 1) {
                this.setPrivateValue("materialId", this.materialId[this.faceMaterialPair[0].materialIndex]);
            }
        }

        this.emitPropertyChanged("materialId", oldMaterisl);
        this.emitPropertyChanged("faceMaterialPair", oldFacePair);
        const newMaterisl = Array.isArray(this.materialId) ? [...this.materialId] : this.materialId;
        Transaction.add(
            this.document,
            new PropertyHistoryRecord(this, "materialId", oldMaterisl, newMaterisl),
        );
        Transaction.add(
            this.document,
            new PropertyHistoryRecord(this, "faceMaterialPair", oldFacePair, [...this.faceMaterialPair]),
        );

        this.document.visual.context.redrawNode([this]);
    };

    protected abstract createMesh(): IShapeMeshData;
}
