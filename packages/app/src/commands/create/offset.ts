// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CancelableCommand,
    Combobox,
    command,
    Dimensions,
    EditableShapeNode,
    GeometryNode,
    GeometryUtils,
    hideCommandProperty,
    I18n,
    type I18nKeys,
    type IDisposable,
    type IEdge,
    type IFace,
    type IShape,
    type IStep,
    type IWire,
    type JoinType,
    MeshDataUtils,
    type PointSnapData,
    PointStep,
    Precision,
    PubSub,
    promptForValue,
    property,
    Result,
    SelectShapeStep,
    type ShapeMeshData,
    type ShapeType,
    ShapeTypes,
    type SnapResult,
    Transaction,
    UnitSetup,
    VisualConfig,
    type VisualNode,
    XYZ,
} from "@chili3d/core";

/**
 * How the offset distance is arrived at, chosen once when the command starts:
 * "distance" offsets every object by a typed distance, "through" sizes each offset so
 * it passes through the point picked for it. AutoCAD's OFFSET asks the same question
 * up front and then keeps the answer for the whole command.
 */
type OffsetMode = "distance" | "through";

const OFFSETABLE = (ShapeTypes.edge | ShapeTypes.wire | ShapeTypes.face) as ShapeType;

/**
 * The selected object plus everything derived from it that stays valid for as long as
 * it is the object being offset. `kernelSign` is resolved lazily on the first preview -
 * see resolveKernelSign for why it is measured rather than assumed.
 */
interface OffsetSource {
    /** The picked shape in world coordinates - an edge, or the wire a wire/face reduces to. */
    shape: IEdge | IWire;
    /** The node the shape belongs to, so the offset copy can inherit its layer/material. */
    node: VisualNode | undefined;
    /** The drawing plane's normal; the only thing the 2D view can be offset around. */
    normal: XYZ;
    kernelSign: number | undefined;
}

/** The offset for one cursor position: which side, how far, and where it was measured. */
interface OffsetGeometry {
    /** Signed distance to hand the kernel - sign included. */
    distance: number;
    /** The point on the source nearest the cursor. */
    nearest: XYZ;
}

/**
 * Reads what the user typed at the opening prompt, AutoCAD-style: a length (in the
 * drawing's units, so `5'6"` works wherever `5.5` does), `T`/`Through` for Through
 * mode, or an empty line to accept the remembered distance shown in the prompt's
 * `<...>`. Returns undefined for anything else, which the prompt reports as an error
 * and keeps asking. Exported for testing.
 */
export function parseOffsetInput(
    text: string,
    remembered: number,
): { mode: OffsetMode; distance?: number } | undefined {
    const trimmed = text.trim();
    if (trimmed === "") {
        return remembered > Precision.Distance ? { mode: "distance" } : undefined;
    }
    if (/^t(hrough)?$/i.test(trimmed)) {
        return { mode: "through" };
    }

    // A negative or zero offset has no meaning - which side is picked, not typed.
    const value = UnitSetup.tryParseLength(trimmed);
    if (value === undefined || value <= Precision.Distance) return undefined;
    return { mode: "distance", distance: value };
}

/**
 * AutoCAD's OFFSET. The command asks for the offset distance (or Through) once, then
 * loops "select an object -> pick the side" until the user exits, so drawing a run of
 * parallel lines is one command rather than one command per line.
 */
@command({
    key: "create.offset",
    icon: "icon-offset",
})
export class OffsetCommand extends CancelableCommand {
    @property("option.command.joinType", {
        combobox: Combobox.from([
            "option.command.joinType.arc",
            "option.command.joinType.tangent",
            "option.command.joinType.intersection",
        ]),
    })
    get joinType(): I18nKeys {
        return this.getPrivateValue("joinType", "option.command.joinType.arc");
    }
    set joinType(value: I18nKeys) {
        this.setProperty("joinType", value);
    }

    /**
     * The remembered offset distance, offered as the default next time the command
     * runs - the value in AutoCAD's `<...>` prompt. Declared as a property purely so
     * CancelableCommand's property cache carries it between invocations; it is hidden
     * from the command bar because the prompt already offers it, and the prompt parses
     * drawing units (`5'6"`) that the bar's plain number box would not.
     */
    @property("common.length")
    get distance(): number {
        return this.getPrivateValue("distance", 1);
    }
    set distance(value: number) {
        this.setProperty("distance", value);
    }

    private mode: OffsetMode = "distance";
    private readonly sourceDisposables = new Set<IDisposable>();

    protected override async executeAsync(): Promise<void> {
        if (!(await this.askOffsetDistance())) return;

        try {
            await Transaction.executeAsync(
                this.document,
                I18n.translate("command.create.offset"),
                async () => {
                    while (!this.isCanceled && (await this.offsetOneAsync())) {
                        // Each pass offsets one object; the loop ends when the user exits.
                    }
                },
            );
        } finally {
            // The last object offset is still selected from its own pick step, which
            // kept it highlighted while the side was chosen.
            this.document.selection.clearSelection();
        }
    }

    // ---------------------------------------------------------------- the prompt

    /**
     * The opening prompt: a distance, `T` for Through, or Enter for the remembered
     * distance. Resolves false when the user backs out - by Escape in the box, or by
     * anything that cancels the command while it is waiting.
     */
    private async askOffsetDistance(): Promise<boolean> {
        this.controller = new AsyncController();
        const answer = await promptForValue({
            controller: this.controller,
            statusTip: "prompt.offset.distance",
            message: I18n.translate("prompt.offset.distance{0}", UnitSetup.formatLength(this.distance)),
            parse: (text) => {
                const parsed = parseOffsetInput(text, this.distance);
                return parsed ? Result.ok(parsed) : Result.err<I18nKeys>("error.offset.invalidDistance");
            },
        });
        if (!answer) return false;

        this.mode = answer.mode;
        if (answer.distance !== undefined) this.distance = answer.distance;
        return true;
    }

    // ------------------------------------------------------------------ the loop

    /** One select-then-offset pass. Returns false once the user has exited. */
    private async offsetOneAsync(): Promise<boolean> {
        const selected = await this.runStep(new SelectShapeStep(OFFSETABLE, "prompt.offset.selectObject"));
        if (!selected) return false;

        const source = this.buildSource(selected);
        if (!source) {
            PubSub.default.pub("showToast", "toast.offset.failed");
            this.releaseSource();
            return true;
        }

        try {
            const tip: I18nKeys = this.mode === "through" ? "prompt.offset.through" : "prompt.offset.side";
            // keepSelected so the object being offset stays highlighted while its side
            // is picked, the way it does in AutoCAD.
            const picked = await this.runStep(new PointStep(tip, this.sideData(source), true));
            if (!picked?.point) return false;

            this.addOffsetNode(source, picked.point);
            return true;
        } finally {
            this.releaseSource();
        }
    }

    private async runStep(step: IStep): Promise<SnapResult | undefined> {
        this.controller = new AsyncController();
        const data = await step.execute(this.document, this.controller);
        return this.controller?.result?.status === "success" ? data : undefined;
    }

    private buildSource(selected: SnapResult): OffsetSource | undefined {
        const picked = selected.shapes.at(0);
        if (!picked) return undefined;

        const world = this.keep(picked.shape.transformedMul(picked.transform));
        let shape: IShape = world;
        if (shape.shapeType === ShapeTypes.face) {
            shape = this.keep((shape as IFace).outerWire());
        }
        if (shape.shapeType !== ShapeTypes.edge && shape.shapeType !== ShapeTypes.wire) {
            return undefined;
        }

        return {
            shape: shape as IEdge | IWire,
            node: picked.owner.node,
            // The view is locked to one drafting plane, so its normal is the offset
            // plane - no need to infer one from the geometry, which fails on the
            // degenerate cases (a single straight edge has no intrinsic normal).
            normal: selected.view.workplane.normal,
            kernelSign: undefined,
        };
    }

    private keep<T extends IShape>(shape: T): T {
        this.sourceDisposables.add(shape);
        return shape;
    }

    private releaseSource() {
        for (const disposable of this.sourceDisposables) {
            disposable.dispose();
        }
        this.sourceDisposables.clear();
    }

    private addOffsetNode(source: OffsetSource, point: XYZ) {
        const geometry = this.offsetGeometry(source, point);
        const offseted = geometry && this.createOffsetShape(source, geometry.distance);
        if (!offseted?.isOk) {
            PubSub.default.pub("showToast", "toast.offset.failed");
            return;
        }

        const owner = source.node;
        const node = new EditableShapeNode({
            document: this.document,
            name: owner?.name ?? I18n.translate("command.create.offset"),
            shape: offseted.value,
            materialId: owner instanceof GeometryNode ? owner.materialId : undefined,
        });
        // AutoCAD's OFFSETLAYER default: the copy lands on the source's layer, not on
        // whatever happens to be current. setPrivateValue because the node is not in
        // the tree yet - this is part of creating it, not an edit of it.
        if (owner) node.setPrivateValue("layerId", owner.layerId);

        this.document.modelManager.addNode(node);
        this.document.visual.update();
    }

    // -------------------------------------------------------------- the geometry

    private readonly sideData = (source: OffsetSource) => (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        preview: (point: XYZ | undefined) => this.preview(source, point),
    });

    private preview(source: OffsetSource, point: XYZ | undefined): ShapeMeshData[] {
        const geometry = point && this.offsetGeometry(source, point);
        if (!geometry) return [];

        const meshes: ShapeMeshData[] = [
            MeshDataUtils.createVertexMesh(
                geometry.nearest,
                VisualConfig.editVertexSize,
                VisualConfig.editVertexColor,
            ),
            MeshDataUtils.createEdgeMesh(geometry.nearest, point, VisualConfig.defaultEdgeColor, "solid"),
        ];

        const offseted = this.createOffsetShape(source, geometry.distance);
        if (offseted.isOk) {
            meshes.push(offseted.value.edgesMeshPosition());
            offseted.value.dispose();
        }
        return meshes;
    }

    /**
     * Turns a cursor position into the signed distance to offset by: the magnitude
     * comes from the mode, the sign from which side of the object the cursor is on.
     */
    private offsetGeometry(source: OffsetSource, cursor: XYZ): OffsetGeometry | undefined {
        const frame = this.frameAt(source, cursor);
        if (!frame) return undefined;

        // Only the in-plane part of the cursor offset says anything about the side.
        const toCursor = cursor.sub(frame.point);
        const inPlane = toCursor.sub(source.normal.multiply(toCursor.dot(source.normal)));
        const side = inPlane.dot(frame.positiveDir);
        if (Math.abs(side) <= Precision.Distance) return undefined;

        const magnitude = this.mode === "through" ? inPlane.length() : this.distance;
        if (magnitude <= Precision.Distance) return undefined;

        source.kernelSign ??= this.resolveKernelSign(source, magnitude, frame.point, frame.positiveDir);
        if (source.kernelSign === undefined) return undefined;

        return {
            distance: source.kernelSign * Math.sign(side) * magnitude,
            nearest: frame.point,
        };
    }

    /**
     * The point on the source nearest the cursor, and the in-plane direction that
     * counts as its positive side. For a wire the tangent is taken along the wire's
     * own traversal direction (reversed edges negated) so neighbouring edges agree on
     * which side is which - otherwise the offset would flip sides as the cursor slid
     * past a corner.
     */
    private frameAt(source: OffsetSource, cursor: XYZ): { point: XYZ; positiveDir: XYZ } | undefined {
        let point: XYZ;
        let tangent: XYZ;

        if (source.shape.shapeType === ShapeTypes.edge) {
            const curve = (source.shape as IEdge).curve;
            const nearest = curve.nearestFromPoint(cursor);
            point = nearest.point;
            tangent = curve.dn(nearest.parameter, 1);
        } else {
            const nearest = GeometryUtils.nearestPoint(source.shape as IWire, cursor);
            if (!nearest) return undefined;
            point = nearest.point;
            tangent = nearest.edge.curve.dn(nearest.parameter, 1);
            if (nearest.edge.orientation() === "reversed") tangent = tangent.multiply(-1);
        }

        const positiveDir = source.normal.cross(tangent).normalize();
        return positiveDir ? { point, positiveDir } : undefined;
    }

    /**
     * Which sign of distance moves the result along `positiveDir`, measured once per
     * selected object by building a trial offset and looking at where it landed.
     *
     * Measuring beats assuming: an edge is offset through Geom_OffsetCurve and a wire
     * through BRepOffsetAPI_MakeOffset, which disagree about which way positive points,
     * and MakeOffset's answer also depends on the plane and orientation OCCT recovers
     * from the wire. Getting this wrong sends the preview to the opposite side from the
     * cursor, which is what the previous implementation did for single edges.
     */
    private resolveKernelSign(
        source: OffsetSource,
        magnitude: number,
        probe: XYZ,
        positiveDir: XYZ,
    ): number | undefined {
        for (const sign of [1, -1]) {
            const trial = this.createOffsetShape(source, sign * magnitude);
            if (!trial.isOk) continue;

            const landed = this.nearestMeshPoint(trial.value, probe);
            trial.value.dispose();
            if (!landed) continue;

            const along = landed.sub(probe).dot(positiveDir);
            if (Math.abs(along) <= Precision.Distance) continue;
            return along > 0 ? sign : -sign;
        }
        return undefined;
    }

    /** The tessellated point of `shape` closest to `point` - enough to tell sides apart. */
    private nearestMeshPoint(shape: IShape, point: XYZ): XYZ | undefined {
        const { position } = shape.edgesMeshPosition();
        let nearest: XYZ | undefined;
        let nearestDistance = Number.MAX_VALUE;

        for (let i = 0; i + 2 < position.length; i += 3) {
            const candidate = new XYZ({ x: position[i], y: position[i + 1], z: position[i + 2] });
            const distance = candidate.distanceTo(point);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = candidate;
            }
        }
        return nearest;
    }

    private createOffsetShape(source: OffsetSource, distance: number): Result<IShape> {
        if (source.shape.shapeType === ShapeTypes.edge) {
            return (source.shape as IEdge).offset(distance, source.normal);
        }
        return (source.shape as IWire).offset(distance, this.mapJoinType());
    }

    readonly mapJoinType = (): JoinType => {
        switch (this.joinType) {
            case "option.command.joinType.arc":
                return "arc";
            case "option.command.joinType.intersection":
                return "intersection";
            case "option.command.joinType.tangent":
                return "tangent";
            default:
                throw new Error("Unknow joinType");
        }
    };
}

hideCommandProperty(OffsetCommand.prototype, ["distance"]);
