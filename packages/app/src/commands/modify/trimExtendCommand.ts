// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    CancelableCommand,
    Combobox,
    Config,
    EditableShapeNode,
    type GeometryNode,
    I18n,
    type I18nKeys,
    type ICurve,
    type IDisposable,
    type IDocument,
    type IEdge,
    type IShape,
    type IShapeFilter,
    type IView,
    type IVisualObject,
    isVisualGeometry,
    Matrix4,
    Precision,
    property,
    type ShapeNode,
    ShapeSelectionHandler,
    ShapeTypes,
    Transaction,
    type TrimExtendMode,
    VisualConfig,
    type VisualShapeData,
} from "@chili3d/core";

/** A stretch of a curve, named by its start and end parameter on that curve. */
export interface ParameterRange {
    start: number;
    end: number;
}

/** The two answers to TRIMEXTENDMODE, as the i18n keys that name them. */
export const TrimExtendModeLabels = {
    quick: "option.command.trimExtendMode.quick",
    standard: "option.command.trimExtendMode.standard",
} as const satisfies Record<TrimExtendMode, I18nKeys>;

/** The prompt lines a trimming command asks in its own words. */
export interface TrimExtendPrompts {
    /** Names the undo step - one step for the whole run, however many edges it touched. */
    label: I18nKeys;
    /** Standard mode's first question: "Select cutting edges" / "Select boundary edges". */
    boundaries: I18nKeys;
    /** The pick loop's question: "Select object to trim" / "... to extend". */
    target: I18nKeys;
}

export class EdgeFilter implements IShapeFilter {
    allow(shape: IShape): boolean {
        return shape.shapeType === ShapeTypes.edge;
    }
}

/**
 * What TRIM or EXTEND is looking at while the cursor is over an edge.
 *
 * All of it is in world space, because the boundaries belong to other nodes and world
 * space is the only ground the two have in common.
 */
export interface EdgeContext {
    /** The edge under the cursor. */
    edge: IEdge;
    /** The curve the edge lies on, untrimmed - EXTEND has to run past the edge's own ends. */
    basis: ICurve;
    /** The edge's own span on `basis`. */
    span: ParameterRange;
    /** Where on `basis` the user is pointing. */
    picked: number;
    /** `basis`'s period, for the curves that close on themselves. Undefined for the rest. */
    period: number | undefined;
    /** The boundary edges, never including the picked edge itself. */
    boundaries: IEdge[];
    /** How far past its own ends this edge could reach and still meet a boundary. */
    reach: number;
    /** Hands a shape or curve to the pick to dispose of when it is over. */
    keep: (disposable: IDisposable) => void;
}

/** What clicking the edge under the cursor would do to it. */
export interface EdgeChange {
    /** The ranges of the basis curve the edge becomes. Empty erases it. */
    result: ParameterRange[];
    /** The stretch this click is about - taken away by TRIM, added by EXTEND. */
    affected: ParameterRange;
}

/** An answered `EdgeChange`: which edge it applies to, and the curve its parameters are on. */
export interface EdgePlan extends EdgeChange {
    target: VisualShapeData;
    basis: ICurve;
}

/**
 * Which of an edge's crossings the pick fell between, and so what TRIM takes away.
 *
 * `intersections` is every parameter at which a boundary crosses the edge, plus the
 * edge's own two ends, sorted. The pick lands in one of the gaps between them: that gap
 * goes, and whatever is left on either side stays. An edge nothing crosses has only its
 * own ends in the list, so the one gap is the whole edge and TRIM erases it - which is
 * AutoCAD's behaviour too.
 *
 * Exported for testing.
 */
export function trimChange(intersections: number[], picked: number): EdgeChange {
    const ends = { start: intersections[0], end: intersections.at(-1)! };
    const index = intersections.findIndex((parameter, i) => i > 0 && picked < parameter);
    if (index < 1) {
        return { affected: ends, result: [] };
    }

    const affected = { start: intersections[index - 1], end: intersections[index] };
    const result: ParameterRange[] = [];
    // The guards are what make a pick near an end erase only that end's stub rather than
    // leaving a zero-length piece of edge behind in the drawing.
    if (affected.start > ends.start) result.push({ start: ends.start, end: affected.start });
    if (affected.end < ends.end) result.push({ start: affected.end, end: ends.end });
    return { affected, result };
}

const wrap = (value: number, period: number) => ((value % period) + period) % period;

/**
 * How far EXTEND stretches the edge, and in which direction - or undefined when there is
 * nothing out there to stretch to.
 *
 * The direction is decided by the pick, as it is in AutoCAD: click nearer one end and it
 * is that end that travels. `candidates` is every parameter at which the edge's own curve,
 * followed past both its ends, meets a boundary; the nearest one beyond the end being
 * extended is where the edge stops. Crossings that fall within the edge's own span are
 * ignored, so EXTEND can only ever lengthen an edge - shortening one is TRIM's job.
 *
 * A closed curve is the one case where "beyond the end" wraps around: an arc's two ends
 * are separated by the gap it does not cover, so the crossings are brought into that gap
 * before the nearest is taken. An arc that has closed into a full circle has no gap left
 * and cannot be extended at all.
 *
 * Exported for testing.
 */
export function extendChange(
    span: ParameterRange,
    picked: number,
    candidates: number[],
    period?: number,
): EdgeChange | undefined {
    const towardsEnd = picked - span.start > span.end - picked;

    if (period !== undefined) {
        if (span.end - span.start >= period - Precision.Float) return undefined;

        const gap = candidates
            .map((parameter) => span.end + wrap(parameter - span.end, period))
            .filter((p) => p > span.end + Precision.Float && p < span.start + period - Precision.Float);
        if (gap.length === 0) return undefined;

        if (towardsEnd) {
            const hit = Math.min(...gap);
            return { result: [{ start: span.start, end: hit }], affected: { start: span.end, end: hit } };
        }
        const hit = Math.max(...gap) - period;
        return { result: [{ start: hit, end: span.end }], affected: { start: hit, end: span.start } };
    }

    if (towardsEnd) {
        const beyond = candidates.filter((p) => p > span.end + Precision.Float);
        if (beyond.length === 0) return undefined;

        const hit = Math.min(...beyond);
        return { result: [{ start: span.start, end: hit }], affected: { start: span.end, end: hit } };
    }

    const before = candidates.filter((p) => p < span.start - Precision.Float);
    if (before.length === 0) return undefined;

    const hit = Math.max(...before);
    return { result: [{ start: hit, end: span.end }], affected: { start: hit, end: span.start } };
}

/** The diagonal of a box, which is the furthest two things inside it can be apart. */
export function boxReach(box: BoundingBox | undefined): number {
    if (!box) return 0;
    const dx = box.max.x - box.min.x;
    const dy = box.max.y - box.min.y;
    const dz = box.max.z - box.min.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function unionBox(left: BoundingBox | undefined, right: BoundingBox | undefined): BoundingBox | undefined {
    if (!left) return right;
    if (!right) return left;
    return new BoundingBox(
        {
            x: Math.min(left.min.x, right.min.x),
            y: Math.min(left.min.y, right.min.y),
            z: Math.min(left.min.z, right.min.z),
        },
        {
            x: Math.max(left.max.x, right.max.x),
            y: Math.max(left.max.y, right.max.y),
            z: Math.max(left.max.z, right.max.z),
        },
    );
}

/**
 * One boundary, kept alongside the shape it was built from.
 *
 * The edge itself is a world-space copy, so it cannot be compared with anything in the
 * drawing; `source` is what lets a pick recognise itself in the boundary set and leave
 * itself out of it, which every one of these sets needs - an edge cannot cut itself, and
 * under <Select All> an edge is always in its own boundary set.
 */
interface BoundaryEdge {
    edge: IEdge;
    source: IShape;
}

/** The boundaries a pick is measured against, and how far apart they and it can be. */
interface BoundaryEdges {
    items: BoundaryEdge[];
    box: BoundingBox | undefined;
}

/**
 * Picks one edge and shows, under the cursor, what clicking it would do.
 *
 * The highlight is the point of the class: TRIM draws the piece about to disappear and
 * EXTEND the piece about to appear, both in the highlight colour, so the click is
 * committing to something already on screen rather than to a guess. Both come from the
 * same `affected` range - see EdgeChange - which is why one handler serves both commands.
 */
export class PickEdgeHandler extends ShapeSelectionHandler {
    #selected: EdgePlan | undefined;
    #highlight: EdgePlan | undefined;
    #highlightMesh: number | undefined;
    readonly #releaseStack = new Set<IDisposable>();

    get selected() {
        return this.#selected;
    }

    constructor(
        document: IDocument,
        controller: AsyncController,
        private readonly makePlan: (
            target: VisualShapeData,
            keep: (disposable: IDisposable) => void,
        ) => EdgePlan | undefined,
    ) {
        super(document, ShapeTypes.shape, false, controller, new EdgeFilter());
    }

    private readonly keep = (disposable: IDisposable) => {
        this.#releaseStack.add(disposable);
    };

    protected override highlightDetecteds(view: IView, detecteds: VisualShapeData[]): void {
        this.cleanHighlights();
        if (detecteds.length !== 1 || detecteds[0].shape.shapeType !== ShapeTypes.edge) return;

        const plan = this.makePlan(detecteds[0], this.keep);
        if (!plan || plan.affected.end - plan.affected.start < Precision.Float) return;

        const curve = plan.basis.trim(plan.affected.start, plan.affected.end);
        this.keep(curve);
        const preview = shapeFactory.edge(curve);
        this.keep(preview);

        const mesh = preview.mesh.edges!;
        mesh.color = VisualConfig.highlightEdgeColor;
        mesh.lineWidth = 3;
        this.#highlightMesh = view.document.visual.highlighter.highlightMesh(mesh);
        this.#highlight = plan;
        view.update();
    }

    protected override cleanHighlights(): void {
        if (this.#highlightMesh !== undefined) {
            this.document.visual.highlighter.removeHighlightMesh(this.#highlightMesh);
            this.#highlightMesh = undefined;
            this.#highlight = undefined;
            this.document.application.activeView?.update();
        }
    }

    protected override clearSelected(): void {
        this.#selected = undefined;
    }

    protected override select(): number {
        this.#selected = this.#highlight;
        return this.#selected ? 1 : 0;
    }

    override disposeInternal(): void {
        super.disposeInternal();

        for (const disposable of this.#releaseStack) {
            disposable.dispose();
        }
        this.#releaseStack.clear();
    }
}

/**
 * TRIM and EXTEND, which are the same command asked in two directions.
 *
 * Both take a set of boundaries and then a run of picks, and both turn each pick into a
 * new parameter range on the curve the picked edge already lies on - TRIM by cutting a
 * piece out between two crossings, EXTEND by running an end on to the next one. What each
 * subclass supplies is that one calculation; everything around it - the boundary phase,
 * the pick loop, the preview, one undo step for the whole run - is here.
 *
 * The boundary phase is AutoCAD's TRIMEXTENDMODE, and the reason "TR Enter Enter" is such
 * durable muscle memory:
 *
 *   Quick     - no boundary prompt at all. Every object in the drawing is a boundary, so
 *               the command is two keystrokes and then clicking.
 *   Standard  - "Select cutting edges:" first, and only what is named there can cut.
 *               Enter with nothing named is AutoCAD's <Select All>, which is the second
 *               Enter of the old two-Enter habit and means the same as Quick.
 */
export abstract class TrimExtendCommand extends CancelableCommand {
    protected abstract get prompts(): TrimExtendPrompts;

    /**
     * Under <Select All>, whether a boundary has to reach the picked edge's own extent to
     * matter. It does for TRIM - nothing can cut a line without crossing it - which lets
     * the search be a box query around the edge rather than a walk of the drawing. EXTEND
     * reaches past the edge by definition, so for it the answer is the whole drawing.
     */
    protected abstract get boundariesCrossTarget(): boolean;

    protected abstract planEdge(context: EdgeContext): EdgeChange | undefined;

    /**
     * AutoCAD's TRIMEXTENDMODE, seen as a dropdown on the command panel. It is one
     * setting for both commands and it outlives them - see Config.trimExtendMode - so the
     * getter reads through to there rather than keeping a copy. CancelableCommand's
     * per-command property cache still saves and restores a copy of its own around every
     * run; that copy is written to a private field this getter never looks at, which is
     * what stops the two commands from drifting apart.
     */
    @property("option.command.trimExtendMode", {
        combobox: Combobox.from<I18nKeys>([TrimExtendModeLabels.quick, TrimExtendModeLabels.standard]),
    })
    get trimExtendMode(): I18nKeys {
        return TrimExtendModeLabels[Config.instance.trimExtendMode];
    }
    set trimExtendMode(value: I18nKeys) {
        const mode = (Object.keys(TrimExtendModeLabels) as TrimExtendMode[]).find(
            (key) => TrimExtendModeLabels[key] === value,
        );
        if (mode === undefined || mode === Config.instance.trimExtendMode) return;

        const oldValue = this.trimExtendMode;
        Config.instance.trimExtendMode = mode;
        this.emitPropertyChanged("trimExtendMode", oldValue);
    }

    /**
     * The mode this run is working in, read once at the start.
     *
     * Re-reading it per pick would let the dropdown change the answer to a question
     * already asked: a Standard run that has taken its cutting edges would start trimming
     * against everything instead the moment the dropdown moved, with the boundaries the
     * user named still sitting on screen. The dropdown takes effect on the next run, as
     * changing a system variable mid-command does in AutoCAD.
     */
    #mode: TrimExtendMode = "quick";

    /** The named boundaries, in world space, or undefined while <Select All> is in force. */
    #picked: BoundaryEdges | undefined;
    /**
     * Every edge in the drawing, under <Select All>. Worked out on demand and thrown away
     * between picks: the drawing cannot change while a pick is unanswered, but each
     * answered pick changes it, so a set that outlived one pick would be measuring
     * against edges that are no longer there.
     */
    #all: BoundaryEdges | undefined;

    protected override async executeAsync(): Promise<void> {
        this.#mode = Config.instance.trimExtendMode;
        this.#picked = undefined;
        this.#all = undefined;
        // Whatever was selected before the command started is not an answer to any
        // question it is about to ask - and in Standard mode it would be read as one.
        this.document.selection.clearSelection();

        if (!(await this.selectBoundaries())) return;

        const transaction = new Transaction(this.document, I18n.translate(this.prompts.label));
        transaction.start();
        try {
            await this.pickLoop();
        } catch (e) {
            transaction.rollback();
            throw e;
        }
        transaction.commit();
    }

    /**
     * The boundary phase. Returns false when the user backed out, which ends the command.
     *
     * Quick mode never asks. In Standard mode an empty answer is not an empty selection
     * but AutoCAD's <Select All>: the second Enter of "TR Enter Enter" arrives here having
     * picked nothing, and means every object in the drawing.
     */
    private async selectBoundaries(): Promise<boolean> {
        if (this.#mode === "quick") return true;

        this.controller = new AsyncController();
        const picked = await this.document.picker.pickShape(this.prompts.boundaries, this.controller, {
            shapeType: ShapeTypes.shape,
            shapeFilter: new EdgeFilter(),
            multi: true,
        });
        if (this.controller.result?.status !== "success") return false;

        // Read now rather than per pick: these are the boundaries as they were named,
        // and a later pick that replaces one of those nodes does not move the line the
        // user pointed at - which is how a cutting-edge set behaves in AutoCAD too.
        if (picked.length > 0) this.#picked = this.worldEdges(picked);

        // The named edges stay in the drawing but not in the selection: a pick can erase
        // the very node a highlight is attached to, and a highlight outliving its node is
        // worse than no highlight at all.
        this.document.selection.clearSelection();
        return true;
    }

    private async pickLoop() {
        while (!this.isCompleted) {
            this.#all = undefined;
            this.controller = new AsyncController();
            const handler = new PickEdgeHandler(this.document, this.controller, this.planFor);
            await this.document.picker.pickAsync(
                handler,
                this.prompts.target,
                this.controller,
                false,
                "select.default",
            );
            if (this.controller.result?.status !== "success" || !handler.selected) {
                handler.dispose();
                break;
            }
            this.applyPlan(handler.selected);
            handler.dispose();
        }
    }

    /** What clicking `target` would do, worked out fresh on every hover. */
    private readonly planFor = (
        target: VisualShapeData,
        keep: (disposable: IDisposable) => void,
    ): EdgePlan | undefined => {
        const edge = target.shape.transformedMul(target.transform) as IEdge;
        keep(edge);

        if (!target.point) return undefined;

        const curve = edge.curve;
        const basis = curve.basisCurve;
        const span = { start: curve.firstParameter(), end: curve.lastParameter() };
        // A generous tolerance, as the pick is a click on a line a few pixels wide rather
        // than a point claimed to be exactly on the curve.
        const picked = curve.parameter(target.point, 5);
        if (picked === undefined) return undefined;

        const boundaries = this.boundariesFor(target, keep);
        const change = this.planEdge({
            edge,
            basis,
            span,
            picked,
            period: basis.isPeriodic() ? basis.period() : undefined,
            boundaries: boundaries.items.filter((x) => x.source !== target.shape).map((x) => x.edge),
            reach: boxReach(unionBox(boundaries.box, target.owner.boundingBox())),
            keep,
        });
        return change && { ...change, target, basis };
    };

    private boundariesFor(target: VisualShapeData, keep: (disposable: IDisposable) => void): BoundaryEdges {
        if (this.#picked) return this.#picked;

        if (this.boundariesCrossTarget) {
            // Only what the edge's own extent reaches can cut it, so the query stays
            // local: no need to rebuild every edge in the drawing on every mouse move.
            const box = target.owner.boundingBox();
            // Expanded, because a boundary that ends exactly on the edge is the ordinary
            // case - two lines meeting at a corner - and an exact box test is a coin toss
            // on whether it counts as touching.
            const visuals = box
                ? this.document.visual.context.boundingBoxIntersectFilter(
                      BoundingBox.expand(box, 1e-3),
                      new EdgeFilter(),
                  )
                : [];
            return this.worldEdgesOf(visuals, keep);
        }

        // EXTEND reaches past the edge, so nothing narrower than the drawing will do.
        this.#all ??= this.worldEdgesOf(this.document.visual.context.visuals(), keep);
        return this.#all;
    }

    /**
     * The edge-bearing visuals among `visuals`, as world-space edges.
     *
     * `keep` rather than the command's own dispose stack, because these are rebuilt as
     * the cursor moves: tying them to the pick means they go when it is answered, instead
     * of piling up for as long as the command runs.
     */
    private worldEdgesOf(visuals: IVisualObject[], keep: (disposable: IDisposable) => void): BoundaryEdges {
        const items: BoundaryEdge[] = [];
        let bounds: BoundingBox | undefined;
        for (const visual of visuals) {
            if (!isVisualGeometry(visual)) continue;

            const shape = (visual.geometryNode as ShapeNode)?.shape?.value;
            if (!shape || shape.shapeType !== ShapeTypes.edge) continue;

            const edge = shape.transformedMul(visual.worldTransform()) as IEdge;
            keep(edge);
            items.push({ edge, source: shape });
            bounds = unionBox(bounds, visual.boundingBox());
        }
        return { items, box: bounds };
    }

    /** The named cutting or boundary edges, which last as long as the command does. */
    private worldEdges(shapes: VisualShapeData[]): BoundaryEdges {
        const items: BoundaryEdge[] = [];
        let bounds: BoundingBox | undefined;
        for (const shape of shapes) {
            if (shape.shape.shapeType !== ShapeTypes.edge) continue;

            const edge = shape.shape.transformedMul(shape.transform) as IEdge;
            this.disposeStack.add(edge);
            items.push({ edge, source: shape.shape });
            bounds = unionBox(bounds, shape.owner.boundingBox());
        }
        return { items, box: bounds };
    }

    /**
     * Replaces the picked node with what is left of it.
     *
     * The pieces are plain edges rather than the node they came from, because the node
     * they came from may no longer be able to describe them - a rectangle with a bite
     * taken out is not a rectangle. Everything that says how the node should look rather
     * than what shape it is - its layer, its linetype, its material - is carried across,
     * so a trimmed line stays on the layer it was drawn on.
     */
    private applyPlan(plan: EdgePlan) {
        const node = this.document.visual.context.getNode(plan.target.owner) as GeometryNode | undefined;
        if (!node?.parent) return;

        // The pieces are built in world space, so they have to be told how to get back
        // out of whatever the node's parent does to them. Identity for a node sitting
        // straight in the document, which is nearly all of them.
        const worldToLocal = plan.target.transform.invert();
        const local = worldToLocal ? node.transform.multiply(worldToLocal) : Matrix4.identity();

        let previous: GeometryNode = node;
        for (const range of plan.result) {
            const curve = plan.basis.trim(range.start, range.end);
            const piece = new EditableShapeNode({
                document: this.document,
                name: node.name,
                shape: shapeFactory.edge(curve),
                materialId: node.materialId,
            });
            curve.dispose();
            piece.transform = local;
            piece.layerId = node.layerId;
            piece.lineType = node.lineType;
            node.parent.insertAfter(previous, piece);
            previous = piece;
        }
        node.parent.remove(node);
    }
}
