import {
    command,
    Dimensions,
    type IEdge,
    type IStep,
    type ISubVertexShape,
    Matrix4,
    MultiStepCommand,
    type PointSnapData,
    PointStep,
    SelectShapeStep,
    type ShapeNode,
    ShapeTypes,
    type StepOption,
    Transaction,
    type VisualShapeData,
    type XYZ,
} from "@chili3d/core";

/**
 * AutoCAD's STRETCH:
 *
 *     Select objects to stretch by crossing-window or crossing-polygon...
 *     Select objects:                                   (crossing pick, Enter to finish)
 *     Specify base point or [Displacement]:
 *     Specify second point or <use first point as displacement>:
 *
 * STRETCH's defining trick is that the *selection* decides how much of an object
 * moves: a vertex caught inside the crossing window is dragged to the new point,
 * a vertex outside it stays exactly where it was, and an edge with both endpoints
 * caught just translates - which is why a shape fully inside the window behaves
 * like MOVE, while one straddling the window edge stretches.
 *
 * That is ported here at vertex granularity instead of reimplementing crossing-vs-
 * window bookkeeping: the selection step below picks ShapeTypes.vertex, and a drag
 * over that step already runs a crossing-rectangle detect (see ShapeSelectionHandler
 * / IView.detectShapesRect), so "grabbed" vertices are exactly the ones the window
 * caught. Everything after that is: move the grabbed vertices, refit the edges that
 * own them, leave the rest of the geometry untouched.
 *
 * Limitation: only straight edges are refit when just one endpoint is grabbed
 * (rebuilt through the two new endpoints). An edge whose curve isn't a line keeps
 * its shape unless *both* its endpoints are grabbed, in which case it just rides
 * along with a rigid translate like any other fully-enclosed geometry. Re-fitting
 * an arc/spline through a single dragged endpoint while preserving its shape is
 * curve-specific work that isn't implemented yet.
 */
@command({
    key: "modify.stretch",
    icon: "icon-stretch",
})
export class Stretch extends MultiStepCommand {
    /** True once the user has answered the base-point prompt with `D`. */
    #displacementMode = false;

    protected override getSteps(): IStep[] {
        const select = new SelectShapeStep(ShapeTypes.vertex, "prompt.select.stretchPoints", {
            multiple: true,
        });

        if (this.#displacementMode) {
            return [select, new PointStep("prompt.move.displacement", this.getDisplacementData, true)];
        }
        return [
            select,
            new PointStep("prompt.move.basePoint", this.getBasePointData, true),
            new PointStep("prompt.move.secondPoint", this.getSecondPointData, true),
        ];
    }

    // Deliberately no resetStepDatas override - see Move for why: restarting into
    // displacement mode must not clear the flag that triggered the restart.

    private readonly getBasePointData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        options: this.#baseOptions,
    });

    readonly #baseOptions = (): StepOption[] => [
        {
            key: "D",
            display: "prompt.option.displacement",
            onSelect: () => {
                this.#displacementMode = true;
                this.restart();
            },
        },
    ];

    private readonly getDisplacementData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
    });

    private readonly getSecondPointData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[1].point!,
        dimension: Dimensions.D1D2D3,
    });

    protected override executeMainTask() {
        const displacement = this.#displacementMode
            ? this.stepDatas[1].point!
            : this.stepDatas[2].point!.sub(this.stepDatas[1].point!);

        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.stretchByNode(displacement);
            this.document.visual.update();
        });
    }

    /** Group the grabbed vertices by owning node, then restretch each node's edges once. */
    private stretchByNode(worldDisplacement: XYZ) {
        const grabbed = this.stepDatas[0].shapes as VisualShapeData[];
        const byNode = new Map<ShapeNode, VisualShapeData[]>();
        grabbed.forEach((v) => {
            const node = v.owner.node as ShapeNode;
            const bucket = byNode.get(node) ?? [];
            bucket.push(v);
            byNode.set(node, bucket);
        });

        byNode.forEach((vertices, node) => {
            // The picked sub-shapes and the node's own shape live in the same local
            // frame (see EdgeCornerCommand / Break, which edit `.shape` directly too),
            // so only the displacement itself needs converting into that frame - and
            // as a direction, not a point, hence ofVector rather than ofPoint.
            const localDisplacement = node.worldTransform().invert()!.ofVector(worldDisplacement);
            const grabbedKeys = new Set(
                vertices.map((v) => this.pointKey((v.shape as ISubVertexShape).point())),
            );
            this.restretchEdges(node, grabbedKeys, localDisplacement);
        });
    }

    /** Move every edge endpoint whose vertex was grabbed; leave the rest fixed. */
    private restretchEdges(node: ShapeNode, grabbedKeys: Set<string>, displacement: XYZ) {
        if (!node.shape.isOk) return;
        const edges = node.shape.value.findSubShapes(ShapeTypes.edge) as IEdge[];

        edges.forEach((edge) => {
            const curve = edge.curve;
            const start = curve.startPoint();
            const end = curve.endPoint();
            const startGrabbed = grabbedKeys.has(this.pointKey(start));
            const endGrabbed = grabbedKeys.has(this.pointKey(end));
            if (!startGrabbed && !endGrabbed) return;

            if (startGrabbed && endGrabbed) {
                // Both ends caught - the whole edge rides along, whatever curve type it is.
                curve.transform(Matrix4.fromTranslation(displacement.x, displacement.y, displacement.z));
                edge.update(curve);
                return;
            }

            if (curve.curveType !== "line") return; // see class doc: arcs/splines not refit yet

            const newStart = startGrabbed ? start.add(displacement) : start;
            const newEnd = endGrabbed ? end.add(displacement) : end;
            const rebuilt = shapeFactory.line(newStart, newEnd);
            if (rebuilt.isOk) edge.update(rebuilt.value.curve);
        });
    }

    /** Rounds to defeat float noise so a shared vertex compares equal across edges. */
    private pointKey(p: XYZ) {
        const r = (n: number) => Math.round(n / 1e-4) * 1e-4;
        return `${r(p.x)},${r(p.y)},${r(p.z)}`;
    }
}
