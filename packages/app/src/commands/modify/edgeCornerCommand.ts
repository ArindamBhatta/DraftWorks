import {
    AsyncController,
    EditableShapeNode,
    I18n,
    type I18nKeys,
    type IEdge,
    type IFace,
    type IShape,
    type IShapeFilter,
    type ISubEdgeShape,
    MultiStepCommand,
    PubSub,
    promptForValue,
    property,
    Result,
    SelectShapeStep,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    type StepOption,
    Transaction,
    type VisualShapeData,
} from "@draftworks/core";

/**
 * Whether a corner operation cuts the selected lines back to the corner it makes -
 * AutoCAD's TRIMMODE, shared by CHAMFER and FILLET.
 */
export type TrimMode = "trim" | "noTrim";

const SOLID_PARENT_TYPES: ShapeType[] = [ShapeTypes.solid, ShapeTypes.compound, ShapeTypes.compoundSolid];
const PLANAR_PARENT_TYPES: ShapeType[] = [ShapeTypes.face, ShapeTypes.wire, ShapeTypes.edge];
const SUPPORTED_PARENT_TYPES: ShapeType[] = [...SOLID_PARENT_TYPES, ...PLANAR_PARENT_TYPES];

/**
 * Whether the parent body holds planar geometry. A compound is classified by
 * its content: containing a solid makes it 3D, otherwise (faces, wires or
 * edges inside) it is treated as 2D.
 */
function isPlanarParent(parent: IShape): boolean {
    if (PLANAR_PARENT_TYPES.includes(parent.shapeType)) return true;
    return parent.shapeType === ShapeTypes.compound && parent.findSubShapes(ShapeTypes.solid).length === 0;
}

/**
 * The face an edge belongs to: the parent itself when it is a face, or the
 * containing face inside a compound; undefined for wire/edge parents.
 */
function faceContaining(parent: IShape, sub: ISubEdgeShape): IFace | undefined {
    if (parent.shapeType === ShapeTypes.face) return parent as IFace;
    if (parent.shapeType !== ShapeTypes.compound) return undefined;

    const faces = parent.findSubShapes(ShapeTypes.face) as IFace[];
    return faces.find((face) => (face.findSubShapes(ShapeTypes.edge) as IEdge[]).some((e) => e.isEqual(sub)));
}

/** Two adjacent sub-edges of a wire, ordered along the wire flow. */
interface OrderedCorner {
    edge1: IEdge;
    edge2: IEdge;
    index1: number;
    index2: number;
}

/** Order the two sub-edges along the wire flow (handles the closed-wire wrap). */
function orderCornerEdges(
    allEdges: IEdge[],
    sub1: ISubEdgeShape,
    sub2: ISubEdgeShape,
): OrderedCorner | undefined {
    const n = allEdges.length;
    let index1 = allEdges.findIndex((x) => x.isEqual(sub1));
    let index2 = allEdges.findIndex((x) => x.isEqual(sub2));
    if (index1 < 0 || index2 < 0) return undefined;

    let [edge1, edge2] = [sub1, sub2] as IEdge[];
    if ((index1 + 1) % n !== index2) {
        [edge1, edge2] = [edge2, edge1];
        [index1, index2] = [index2, index1];
    }
    return { edge1, edge2, index1, index2 };
}

/** Splice the corner's new edges into the wire in place of the two old ones. */
function spliceCornerEdges(allEdges: IEdge[], corner: OrderedCorner, pieces: IEdge[]): IEdge[] {
    const { index1, index2 } = corner;
    if (index1 === allEdges.length - 1) {
        // closed-wire wrap: the corner spans the last and the first edge, so the piece
        // that ends the run comes back round to the front
        return [pieces[pieces.length - 1], ...allEdges.slice(1, -1), ...pieces.slice(0, -1)];
    }
    return [...allEdges.slice(0, index1), ...pieces, ...allEdges.slice(index2 + 1)];
}

/**
 * Base class for the chamfer and fillet commands. Both reshape the corner of
 * the selected edges - on a solid or a compound of solids (3D), on a face or
 * a compound of faces (2D), on a wire, or between two standalone edge
 * bodies - and differ only in the actual shape operation, provided by the
 * `applyTo*` methods.
 */
export abstract class EdgeCornerCommand extends MultiStepCommand {
    /** Apply the operation to the selected edges of a solid or compound. */
    protected abstract applyToBody(shape: IShape, edgeIndexes: number[]): Result<IShape>;

    /** Apply the operation to the corner between two edges of a face. */
    protected abstract applyToFace(face: IFace, edge1: IEdge, edge2: IEdge): Result<IShape>;

    /**
     * Reshape the corner between two adjacent edges, as the run of edges it becomes,
     * ordered along the wire flow: the two trimmed edges with the corner edge between
     * them, or just the two when the corner they now share is a sharp one and there is
     * nothing to put between them - see FilletCommand at radius 0.
     */
    protected abstract applyToEdgePair(edge1: IEdge, edge2: IEdge): Result<IEdge[]>;

    /**
     * Every edge the two prompts named, in the order they were picked.
     *
     * The second prompt keeps the first edge selected, so its own result already holds
     * both - but it holds them in selection order, which is not necessarily pick order,
     * and for a chamfer the difference is the whole point: an unequal chamfer put on the
     * wrong way round is the mirror of the one asked for. So the first pick is taken
     * from its own step and the rest follow it.
     */
    private pickedEdges(): VisualShapeData[] {
        const first = this.stepDatas[0].shapes[0];
        // Polyline stops after one pick - the edge only names which wire is meant, and
        // there is no second step to have produced anything.
        const second = this.stepDatas[1];
        if (second === undefined) return [first];

        const rest = second.shapes.filter((x) => !x.shape.isEqual(first.shape));
        return [first, ...rest];
    }

    /**
     * Polyline needs one pick, not two: the edge picked says which wire, and every
     * corner of it is chamfered. So the second prompt is skipped once the first pick has
     * been made in that mode - which is only knowable then, since the option is chosen
     * at the first prompt.
     */
    protected override async executeSteps(): Promise<boolean> {
        const steps = this.getSteps();
        this.controller = new AsyncController();

        const first = await steps[0].execute(this.document, this.controller);
        if (first === undefined || this.controller.result?.status !== "success") return false;
        this.stepDatas.push(first);

        if (this.wholeWireMode) return true;

        this.controller = new AsyncController();
        const second = await steps[1].execute(this.document, this.controller);
        if (second === undefined || this.controller.result?.status !== "success") return false;
        this.stepDatas.push(second);
        return true;
    }

    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const shapes = this.pickedEdges();
            const parent = (shapes[0].shape as ISubEdgeShape).parent;

            if (parent.shapeType === ShapeTypes.edge) {
                this.modifyStandaloneEdges(shapes);
                return;
            }

            this.modifyNode(shapes, parent);
        });
    }

    private modifyNode(shapes: VisualShapeData[], parent: IShape) {
        const node = shapes[0].owner.node as ShapeNode;
        const newShape = this.computeNewShape(shapes, parent, node);
        if (!newShape.isOk) {
            PubSub.default.pub("displayError", newShape.error);
            return;
        }
        this.replaceNode(node, newShape.value);
    }

    private computeNewShape(shapes: VisualShapeData[], parent: IShape, node: ShapeNode): Result<IShape> {
        if (isPlanarParent(parent)) {
            return this.computePlanarShape(shapes, parent);
        }

        const edgeIndexes = shapes.map((x) => (x.shape as ISubEdgeShape).index);
        return this.applyToBody(node.shape.value, edgeIndexes);
    }

    private computePlanarShape(shapes: VisualShapeData[], parent: IShape): Result<IShape> {
        // Polyline names a whole wire with one pick, so there is no second edge to wait
        // for and no corner to single out - every corner of the wire is the answer.
        if (this.wholeWireMode) {
            return this.modifyWholeWire(parent);
        }

        if (shapes.length !== 2) {
            return Result.err(I18n.translate("error.select.twoEdges"));
        }

        const face = faceContaining(parent, shapes[0].shape as ISubEdgeShape);
        return face !== undefined
            ? this.applyToFace(face, shapes[0].shape as IEdge, shapes[1].shape as IEdge)
            : this.modifyWireCorner(
                  parent,
                  shapes[0].shape as ISubEdgeShape,
                  shapes[1].shape as ISubEdgeShape,
              );
    }

    private replaceNode(node: ShapeNode, shape: IShape) {
        if (node instanceof EditableShapeNode) {
            node.shape = Result.ok(shape);
        } else {
            const model = new EditableShapeNode({
                document: this.document,
                name: node.name,
                shape,
                materialId: node.materialId,
            });
            model.transform = node.transform;

            (node.parent ?? this.document.modelManager.rootNode).add(model);
            node.parent?.remove(node);
        }

        this.document.visual.update();
    }

    /**
     * Every corner of a wire at once - AutoCAD's Polyline option.
     *
     * Done in one pass over the original edges rather than by running the two-edge
     * corner repeatedly: each corner replaces the two edges that made it, so the edge
     * list shifts under any index taken before the previous corner was applied. Here
     * each edge is cut at both its ends against the wire as it was picked, and the wire
     * is rebuilt once from the results.
     *
     * A corner the operation cannot make - two edges that are parallel, or a radius too
     * big for the lines meeting there - is left as it is rather than failing the whole
     * polyline, which is what AutoCAD does and the only behaviour that makes the option
     * useful on a real outline.
     */
    protected modifyWholeWire(wire: IShape): Result<IShape> {
        const edges = wire.findSubShapes(ShapeTypes.edge) as IEdge[];
        if (edges.length < 2) return Result.err(I18n.translate("error.corner.wireTooShort"));

        // A closed wire has a corner where its last edge meets its first; an open one
        // ends there, so its final edge has no corner beyond it.
        const closed = wire.isClosed();
        // Each entry is what that corner turned its two edges into; a corner left alone
        // contributes nothing and its edges stay whole.
        const pieces = new Map<number, IEdge[]>();
        const lastCorner = closed ? edges.length - 1 : edges.length - 2;

        for (let i = 0; i <= lastCorner; i++) {
            const next = (i + 1) % edges.length;
            // Each edge is cut against what the previous corner already did to it, so a
            // short edge between two corners is trimmed from both ends rather than twice
            // from its original length.
            const first = pieces.get(i)?.at(-1) ?? edges[i];
            // Likewise the second edge: on a closed wire its leading piece may already
            // have been trimmed by corner 0, and cutting the original again would undo
            // that trim.
            const second = pieces.get(next)?.[0] ?? edges[next];
            const corner = this.applyToEdgePair(first, second);
            if (!corner.isOk) continue;

            const parts = corner.value;
            // The trimmed first edge and the chamfer stay with this corner, replacing
            // whatever the previous corner had left as this edge's last piece.
            pieces.set(i, [...(pieces.get(i)?.slice(0, -1) ?? []), ...parts.slice(0, -1)]);

            // The trimmed second edge becomes that edge's starting state for its own
            // corner. On a closed wire the final corner's `next` is edge 0, which corner
            // 0 has already cut and hung its chamfer on - so this replaces only that
            // edge's leading piece and leaves the rest of its run alone. Overwriting the
            // whole entry would throw away the first chamfer and leave edge 0 untrimmed
            // at the end it shares with corner 0.
            const existing = pieces.get(next);
            const trimmedSecond = parts[parts.length - 1];
            pieces.set(next, existing ? [trimmedSecond, ...existing.slice(1)] : [trimmedSecond]);
        }

        const rebuilt: IEdge[] = [];
        for (let i = 0; i < edges.length; i++) {
            rebuilt.push(...(pieces.get(i) ?? [edges[i]]));
        }
        return shapeFactory.wire(rebuilt);
    }

    /** Modify the corner between two adjacent edges of a wire and rebuild the wire. */
    private modifyWireCorner(wire: IShape, sub1: ISubEdgeShape, sub2: ISubEdgeShape): Result<IShape> {
        const allEdges = wire.findSubShapes(ShapeTypes.edge) as IEdge[];
        const corner = orderCornerEdges(allEdges, sub1, sub2);
        if (corner === undefined) return Result.err("Edges must belong to the wire.");

        const pieces = this.applyToEdgePair(corner.edge1, corner.edge2);
        if (!pieces.isOk) return pieces.parse();

        return shapeFactory.wire(spliceCornerEdges(allEdges, corner, pieces.value));
    }

    /** Apply the corner between two standalone edge bodies, keeping them as separate edges. */
    private modifyStandaloneEdges(shapes: VisualShapeData[]) {
        if (shapes.length !== 2) {
            PubSub.default.pub("displayError", I18n.translate("error.select.twoEdges"));
            return;
        }

        const [edge1, edge2] = shapes.map((x) => {
            const edge = x.shape.transformedMul(x.transform) as IEdge;
            this.disposeStack.add(edge);
            return edge;
        });

        const pieces = this.applyToEdgePair(edge1, edge2);
        if (!pieces.isOk) {
            PubSub.default.pub("displayError", pieces.error);
            return;
        }

        this.replaceStandaloneNodes(shapes, pieces.value);
    }

    /**
     * Replace the two standalone edge nodes by their trimmed versions, and add the corner
     * edge as a third standalone edge when the corner has one - a sharp corner does not.
     * The pieces' geometry is in world space (the transforms were baked in), so no
     * transform is copied.
     */
    private replaceStandaloneNodes(shapes: VisualShapeData[], pieces: IEdge[]) {
        const trimmed1 = pieces[0];
        const trimmed2 = pieces[pieces.length - 1];
        const cornerEdge = pieces.length > 2 ? pieces[1] : undefined;
        const node1 = shapes[0].owner.node as ShapeNode;
        const node2 = shapes[1].owner.node as ShapeNode;
        const container1 = node1.parent ?? this.document.modelManager.rootNode;
        const container2 = node2.parent ?? this.document.modelManager.rootNode;

        container1.add(this.standaloneEdgeNode(node1, trimmed1));
        container2.add(this.standaloneEdgeNode(node2, trimmed2));
        if (cornerEdge) {
            container1.add(this.standaloneEdgeNode(node1, cornerEdge, `${node1.name}_1`));
        }
        node1.parent?.remove(node1);
        node2.parent?.remove(node2);
        this.document.visual.update();
    }

    private standaloneEdgeNode(source: ShapeNode, shape: IEdge, name?: string) {
        return new EditableShapeNode({
            document: this.document,
            name: name ?? source.name,
            shape,
            materialId: source.materialId,
        });
    }

    /**
     * The first selected edge determines the main shape; subsequent edges can
     * only be picked on the same shape (same TShape as the first edge's parent).
     * A standalone edge body can only be paired with another standalone edge.
     * 2D operations (face, wire, standalone edges) apply to exactly two edges.
     */
    private readonly _edgeFilter: IShapeFilter = {
        allow: (shape) => this.canPickEdge(shape as ISubEdgeShape),
    };

    private canPickEdge(shape: ISubEdgeShape): boolean {
        const parent = shape.parent;
        if (parent === undefined || !SUPPORTED_PARENT_TYPES.includes(parent.shapeType)) return false;

        const selected = this.document.selection.getSelectedShapes();
        const firstParent = (selected.at(0)?.shape as ISubEdgeShape | undefined)?.parent;
        if (firstParent === undefined) return true;
        if (!this.isSameMainShape(parent, firstParent)) return false;

        const is3d = !isPlanarParent(firstParent);
        if (!is3d && selected.length >= 2) {
            // allow re-picking an already selected edge so it can be toggled off
            return selected.some((x) => x.shape.isEqual(shape));
        }
        return true;
    }

    /** A standalone edge only pairs with standalone edges; body edges must share the first edge's body. */
    private isSameMainShape(parent: IShape, firstParent: IShape): boolean {
        if (firstParent.shapeType === ShapeTypes.edge) {
            return parent.shapeType === ShapeTypes.edge;
        }
        return parent.shapeType !== ShapeTypes.edge && parent.isPartner(firstParent);
    }

    /**
     * Whether the selected lines are cut back to the corner, AutoCAD's TRIMMODE.
     *
     * It lives here rather than on either command because AutoCAD keeps one setting for
     * both: turn trimming off in CHAMFER and FILLET is untrimmed too, which matters
     * because the usual reason to want it off - laying a corner over geometry that has
     * to stay whole - does not care which of the two drew the corner.
     */
    @property("option.command.trimMode.trim")
    get trimMode(): TrimMode {
        return this.getPrivateValue("trimMode", "trim");
    }

    set trimMode(value: TrimMode) {
        this.setProperty("trimMode", value);
    }

    /** `[Trim/No trim]` - the option that flips it, offered by both commands. */
    protected trimOption(): StepOption {
        return {
            key: "T",
            name: "prompt.optionName.trim",
            display: "prompt.option.trim",
            onSelect: () => {
                void this.askTrimMode();
            },
        };
    }

    private async askTrimMode() {
        const controller = new AsyncController();
        this.disposeStack.add(controller);

        const mode = await promptForValue<TrimMode>({
            controller,
            statusTip: "prompt.chamfer.trimMode",
            // The whole question here - there is no free value to give instead, which is
            // what drops AutoCAD's "or".
            optionsOnly: true,
            choices: [
                { key: "T", name: "prompt.optionName.trim" },
                { key: "N", name: "prompt.optionName.noTrim" },
            ],
            defaultAnswer: I18n.translate(
                this.trimMode === "trim" ? "option.command.trimMode.trim" : "option.command.trimMode.noTrim",
            ),
            parse: (text) => {
                const key = text.trim().toUpperCase();
                if (key === "T") return Result.ok<TrimMode>("trim");
                if (key === "N") return Result.ok<TrimMode>("noTrim");
                return Result.err<I18nKeys>("error.input.unsupportedInputs");
            },
        });

        if (mode !== undefined) this.trimMode = mode;
        PubSub.default.pub("refreshStepPrompt");
    }

    /**
     * Whether this run takes a whole polyline rather than one corner - AutoCAD's
     * Polyline option.
     *
     * Unlike the trim mode and the distances, it is not remembered: it says what this
     * one run is doing, and a command that silently chamfered an entire outline because
     * the last run did would be a surprise every time.
     */
    protected wholeWireMode = false;

    protected override onRestarting(): void {
        super.onRestarting();
        // The mode belongs to the run that chose it, and a restart is a new run.
        this.wholeWireMode = false;
    }

    /** `[Polyline]` - the option that switches this run to a whole wire. */
    protected polylineOption(): StepOption {
        return {
            key: "P",
            name: "prompt.optionName.polyline",
            display: "prompt.option.polyline",
            onSelect: () => {
                this.wholeWireMode = true;
                PubSub.default.pub("refreshStepPrompt");
            },
        };
    }

    /**
     * The settings this command offers at its selection prompt, AutoCAD-style:
     * `FILLET Select first object or [Radius]:`. Nothing by default - a subclass with a
     * setting worth changing mid-command overrides this.
     */
    protected selectionOptions(): StepOption[] {
        return [];
    }

    /**
     * The two prompts AutoCAD asks a corner in: `Select first line`, then, once that has
     * been picked, `Select second line`.
     *
     * One multi-select prompt would be fewer steps and is what this command used to do,
     * but it asks the question wrongly: a corner has a first line and a second, the
     * options belong to the first prompt the way `[Distance/Angle/Trim/mEthod]` does,
     * and "pick two things" leaves the user to discover how many is enough. The 3D case
     * genuinely is a set of edges rather than a corner, so it keeps its one prompt -
     * which the first pick is what decides, since only then is the parent body known.
     */
    protected override getSteps() {
        return [
            // A provider for the same reason the options are one: choosing Polyline at
            // this very prompt changes what it is asking for, and it has to say so.
            new SelectShapeStep(ShapeTypes.edge, () => this.firstPrompt(), {
                shapeFilter: this._edgeFilter,
                // A provider, not a snapshot: the radius shown between the brackets has
                // to be the radius now, including one just typed at this same prompt.
                stepOptions: () => this.selectionOptions(),
            }),
            // A provider: what this prompt should say depends on the first pick, and
            // both steps are built before either runs.
            new SelectShapeStep(ShapeTypes.edge, () => this.secondPrompt(), {
                // The first edge stays selected while the second is picked, so the corner
                // being made is visible as it is named.
                keepSelection: true,
                multiple: true,
                shapeFilter: this._edgeFilter,
                canFinish: this._canFinish,
                stepOptions: () => this.selectionOptions(),
            }),
        ];
    }

    /** `Select first line` - overridden where a command words it its own way. */
    protected firstPrompt(): I18nKeys {
        // Choosing Polyline changes what is being asked for, not just what happens after
        // - so the prompt says so rather than still asking for a line.
        if (this.wholeWireMode) return "prompt.chamfer.polyline";
        return "prompt.corner.selectFirst";
    }

    /**
     * `Select second line` for a corner - but a solid is not a corner, and the same
     * prompt would be asking for one line while accepting many. Resolved when the step
     * runs rather than when it is built, because the first pick is what says which.
     */
    protected secondPrompt(): I18nKeys {
        const firstParent = (this.stepDatas[0]?.shapes[0]?.shape as ISubEdgeShape | undefined)?.parent;
        if (firstParent !== undefined && !isPlanarParent(firstParent)) {
            return "prompt.select.edges";
        }
        return "prompt.corner.selectSecond";
    }

    /**
     * When the second prompt has what it needs. A 2D corner is done at two edges - the
     * one already picked plus this one - while a solid takes as many as the user cares
     * to name and ends on Enter.
     */
    private readonly _canFinish = (selected: VisualShapeData[]) => {
        const parent = (selected.at(0)?.shape as ISubEdgeShape | undefined)?.parent;
        if (parent === undefined) return false;
        return isPlanarParent(parent) && selected.length === 2;
    };
}
