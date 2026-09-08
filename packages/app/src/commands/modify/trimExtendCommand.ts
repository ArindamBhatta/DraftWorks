import {
    AsyncController,
    BoundingBox,
    CancelableCommand,
    Combobox,
    Config,
    type CursorType,
    EditableShapeNode,
    type GeometryNode,
    I18n,
    type I18nKeys,
    type ICurve,
    type IDisposable,
    type IDocument,
    type IEdge,
    type IEventHandler,
    type IShape,
    type IShapeFilter,
    type IView,
    type IVisualObject,
    isVisualGeometry,
    Matrix4,
    matchStepOption,
    Precision,
    PubSub,
    promptForValue,
    property,
    Result,
    type ShapeNode,
    ShapeSelectionHandler,
    ShapeTypes,
    type StepOption,
    SubshapeSelectionHandler,
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

/**
 * The mode an option label names, going back the way TrimExtendModeLabels came.
 *
 * The dropdown deals in labels and the setting deals in modes, so this is the join
 * between them - and a silent one if it ever stops matching: a label that no longer maps
 * makes the setter a no-op, which looks exactly like a dropdown that will not move.
 *
 * Exported for testing.
 */
export function trimExtendModeOf(label: I18nKeys): TrimExtendMode | undefined {
    return (Object.keys(TrimExtendModeLabels) as TrimExtendMode[]).find(
        (mode) => TrimExtendModeLabels[mode] === label,
    );
}

/**
 * Reads the answer to "[Quick/Standard]" the AutoCAD way: `Q`/`Quick`, `S`/`Standard`
 * however capitalised, or an empty line for the answer the prompt is already showing in
 * its `<...>`. Anything else is rejected and the question asked again.
 *
 * Exported for testing.
 */
export function parseTrimExtendMode(text: string, remembered: I18nKeys): I18nKeys | undefined {
    const trimmed = text.trim();
    if (trimmed === "") return remembered;
    if (/^q(uick)?$/i.test(trimmed)) return TrimExtendModeLabels.quick;
    if (/^s(tandard)?$/i.test(trimmed)) return TrimExtendModeLabels.standard;
    return undefined;
}

/**
 * The prompt lines a trimming command asks in its own words.
 *
 * The pick loop has two of them because the two modes are two different jobs wearing the
 * same command name: in Quick mode every object in the drawing cuts, in Standard mode only
 * the edges just named do. A prompt that read the same either way would leave the one
 * thing the user needs to know - what is going to happen when they click - to be inferred
 * from whether a question was asked a moment ago.
 */
export interface TrimExtendPrompts {
    /** Names the undo step - one step for the whole run, however many edges it touched. */
    label: I18nKeys;
    /** Standard mode's first question: "Select cutting edges" / "Select boundary edges". */
    boundaries: I18nKeys;
    /** The pick loop's question in Quick mode, where the whole drawing is the boundary. */
    quickTarget: I18nKeys;
    /** The pick loop's question in Standard mode, where only the named edges are. */
    standardTarget: I18nKeys;
    /** "Enter a trim mode option [Quick/Standard]" - the status-bar line. */
    mode: I18nKeys;
    /** The same question with room for the remembered answer's `<...>`. */
    modeDefault: I18nKeys;
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
 * Runs the prompt option a keystroke names, if it names one.
 *
 * The status bar renders the same options as buttons, so this is the typed half of a
 * pipeline that already has a clicked half - see Statusbar.showStepOptions. Selection
 * prompts get it here rather than from SnapEventHandler, which is where every other kind
 * of prompt gets it: a pick that is choosing objects has no typing box of its own, and
 * without this the `[O]` in the status bar would be clickable but not typeable, which is
 * the sort of half-working affordance that teaches people to stop trying.
 */
function handleOptionKey(options: StepOption[], event: KeyboardEvent): boolean {
    const option = matchStepOption(options, event.key);
    if (!option) return false;

    event.preventDefault();
    event.stopImmediatePropagation();
    option.onSelect();
    return true;
}

/** The multi-pick that names the cutting or boundary edges, with the prompt's options live. */
class PickBoundaryHandler extends SubshapeSelectionHandler {
    constructor(
        document: IDocument,
        controller: AsyncController,
        private readonly options: StepOption[],
    ) {
        super(document, ShapeTypes.shape, true, controller, new EdgeFilter());
    }

    override keyDown(view: IView, event: KeyboardEvent): void {
        if (handleOptionKey(this.options, event)) return;
        super.keyDown(view, event);
    }
}

/** How a pick should look and what else it will answer to. */
export interface PickEdgeOptions {
    /** What clicking `target` would do, worked out fresh on every hover. */
    plan: (target: VisualShapeData, keep: (disposable: IDisposable) => void) => EdgePlan | undefined;
    /** The colour of the stretch the click is about - see VisualConfig.trimPreviewColor. */
    previewColor: number;
    /** Alternatives offered at this prompt: typed here, clicked in the status bar. */
    options: StepOption[];
}

/**
 * Picks one edge and shows, under the cursor, what clicking it would do.
 *
 * The preview is the point of the class. TRIM draws the piece about to disappear in red
 * and EXTEND the piece about to appear in green, right on top of the edge they describe,
 * so a click is committing to something already on screen rather than to a guess about
 * which side of a crossing the cursor counted as. Both come from the same `affected`
 * range - see EdgeChange - which is why one handler serves both commands.
 *
 * An edge the command can do nothing with gets the ordinary hover highlight instead. That
 * distinction is the whole answer to "why did nothing happen when I clicked": blue says
 * the edge was found but there is nothing here to do, and no highlight at all says the
 * cursor never found an edge in the first place.
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
        private readonly pick: PickEdgeOptions,
    ) {
        super(document, ShapeTypes.shape, false, controller, new EdgeFilter());
    }

    override keyDown(view: IView, event: KeyboardEvent): void {
        if (handleOptionKey(this.pick.options, event)) return;
        super.keyDown(view, event);
    }

    private readonly keep = (disposable: IDisposable) => {
        this.#releaseStack.add(disposable);
    };

    protected override highlightDetecteds(view: IView, detecteds: VisualShapeData[]): void {
        this.cleanHighlights();
        if (detecteds.length !== 1 || detecteds[0].shape.shapeType !== ShapeTypes.edge) return;

        const plan = this.pick.plan(detecteds[0], this.keep);
        if (!plan || plan.affected.end - plan.affected.start < Precision.Float) {
            // Nothing to trim back to, or nothing to reach out to. Say so with the plain
            // hover highlight rather than with silence, which reads as a broken command.
            super.highlightDetecteds(view, detecteds);
            return;
        }

        const curve = plan.basis.trim(plan.affected.start, plan.affected.end);
        this.keep(curve);
        const preview = shapeFactory.edge(curve);
        this.keep(preview);

        const mesh = preview.mesh.edges!;
        mesh.color = this.pick.previewColor;
        mesh.lineWidth = VisualConfig.trimExtendPreviewLineWidth;
        this.#highlightMesh = view.document.visual.highlighter.highlightMesh(mesh);
        this.#highlight = plan;
        view.update();
    }

    protected override cleanHighlights(): void {
        // Both kinds have to go: the plain hover highlight the base class puts on an edge
        // there is nothing to do with, and this class's own red or green preview.
        super.cleanHighlights();
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

    /** The colour of the stretch a click is about - red for gone, green for arriving. */
    protected abstract get previewColor(): number;

    protected abstract planEdge(context: EdgeContext): EdgeChange | undefined;

    /**
     * AutoCAD's TRIMEXTENDMODE, seen as a dropdown on the command panel. It is one
     * setting for both commands and it outlives them - see Config.trimExtendMode - so the
     * getter reads through to there rather than keeping a copy. CancelableCommand's
     * per-command property cache still saves and restores a copy of its own around every
     * run; that copy is written to a private field this getter never looks at, which is
     * what stops the two commands from drifting apart.
     *
     * It greys out once the run commits to a mode - see `modeLocked`.
     */
    @property("option.command.trimExtendMode", {
        combobox: Combobox.from<I18nKeys>([TrimExtendModeLabels.quick, TrimExtendModeLabels.standard]),
        disabledWhen: [{ property: "modeLocked", value: true }],
    })
    get trimExtendMode(): I18nKeys {
        return TrimExtendModeLabels[Config.instance.trimExtendMode];
    }
    set trimExtendMode(value: I18nKeys) {
        const mode = trimExtendModeOf(value);
        if (this.#locked || mode === undefined || mode === Config.instance.trimExtendMode) return;

        this.applyMode(mode);
        // Reaching for the dropdown is choosing the mode for this run, which is the same
        // commitment the `[O]` question ends with - so it is the last change this run
        // will take, and the run begins again under it. Restarting is what keeps the
        // dropdown, the prompt and what the command is actually doing describing one
        // state instead of three.
        this.lockMode();
        this.restart();
    }

    /** Writes the setting and tells the panel, without the restart the setter also does. */
    private applyMode(mode: TrimExtendMode) {
        if (mode === Config.instance.trimExtendMode) return;

        const oldValue = this.trimExtendMode;
        Config.instance.trimExtendMode = mode;
        this.emitPropertyChanged("trimExtendMode", oldValue);
    }

    /**
     * Whether this run has committed to a mode.
     *
     * A run works in one mode from beginning to end. The two are not variations on one
     * job: Standard cuts against the edges you named a moment ago and Quick cuts against
     * everything, so an answer given under one of them means something else under the
     * other. Letting the mode move mid-run would silently re-read work already done -
     * cutting edges named and then ignored, or a boundary set that was never asked for -
     * and leave the user to notice from the results.
     *
     * So the mode is settled before the run does anything and fixed the moment it does:
     * answering the `[O]` question locks it, and so does the first real work, whether that
     * is naming the cutting edges or trimming the first edge. From then on the dropdown
     * greys out and `[O]` stops being offered, both of them still showing which mode the
     * run is in. Starting the command again is how you get the other one.
     */
    get modeLocked() {
        return this.#locked;
    }

    #locked = false;

    private lockMode() {
        if (this.#locked) return;

        this.#locked = true;
        // Greys the dropdown - see the property's disabledWhen. `[O]` goes on its own,
        // because modeOptions stops offering it.
        this.emitPropertyChanged("modeLocked", false);
    }

    /** The mode this run is working in, read once at the start and then locked. */
    #mode: TrimExtendMode = "quick";

    /** Set by `O`, so the mode question is asked once this prompt has been torn down. */
    #askMode = false;

    /** The named boundaries, in world space, or undefined while <Select All> is in force. */
    #picked: BoundaryEdges | undefined;
    /**
     * Every edge in the drawing, under <Select All>. Worked out on demand and thrown away
     * between picks: the drawing cannot change while a pick is unanswered, but each
     * answered pick changes it, so a set that outlived one pick would be measuring
     * against edges that are no longer there.
     */
    #all: BoundaryEdges | undefined;

    /** The pick loop's question, in the words of the mode this run is working in. */
    private get targetPrompt(): I18nKeys {
        return this.#mode === "quick" ? this.prompts.quickTarget : this.prompts.standardTarget;
    }

    /**
     * AutoCAD's `[mOde]`, offered until the run commits to a mode and then not at all.
     *
     * It is the same setting as the dropdown on the command panel, reached from the other
     * end: the status bar shows it as a clickable `O` and the pick handlers answer to the
     * key, so whichever one the user reaches for, the other follows. Without it the mode
     * could only be changed from the ribbon, which is the wrong place to be looking when
     * the question you are answering is on the status bar.
     *
     * It disappears once `modeLocked` - at that point the dropdown, greyed, is the thing
     * still saying which mode the run is in, and the answer is no longer up for changing.
     */
    private modeOptions(): StepOption[] {
        if (this.#locked) return [];

        return [
            {
                key: "O",
                display: "prompt.option.trimExtendMode",
                onSelect: () => {
                    // The question needs the input box and this prompt still holds it, so
                    // it is asked on the way back in rather than from here.
                    this.#askMode = true;
                    this.restart();
                },
            },
        ];
    }

    /**
     * AutoCAD's "Enter a trim mode option [Quick/Standard] <Quick>". Returns false when
     * the user backs out, which ends the command the way Escape at any other prompt does.
     *
     * Answering it settles the mode for the whole run: the Enter that closes this prompt
     * is the last chance to change it.
     */
    private async askModeQuestion(): Promise<boolean> {
        this.controller = new AsyncController();
        const answer = await promptForValue({
            controller: this.controller,
            statusTip: this.prompts.mode,
            message: I18n.translate(this.prompts.modeDefault, I18n.translate(this.trimExtendMode)),
            parse: (text) => {
                const mode = parseTrimExtendMode(text, this.trimExtendMode);
                return mode ? Result.ok(mode) : Result.err<I18nKeys>("error.trimExtend.invalidMode");
            },
        });
        if (answer === undefined) return false;

        // applyMode rather than the setter, which would restart a run that is already
        // restarting - this is being asked from inside the restart the `O` set off. The
        // dropdown still follows, because applyMode is what tells the panel.
        const mode = trimExtendModeOf(answer);
        if (mode !== undefined) this.applyMode(mode);
        return true;
    }

    protected override async executeAsync(): Promise<void> {
        if (this.#askMode) {
            this.#askMode = false;
            if (!(await this.askModeQuestion())) return;
            // Answered, so the run has its mode: `[O]` stops being offered and the
            // dropdown greys before the first real question is asked.
            this.lockMode();
        }

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
        const options = this.modeOptions();
        const handler = new PickBoundaryHandler(this.document, this.controller, options);
        // The bare pickbox, without the crosshair: this prompt is choosing objects, not
        // aiming at a point, and AutoCAD's "Select cutting edges:" looks the same way.
        await this.pickWithOptions(handler, this.prompts.boundaries, this.controller, {
            showControl: true,
            cursor: "select.objects",
            options,
        });
        const picked = this.document.selection.getSelectedShapes();
        handler.dispose();
        if (this.controller.result?.status !== "success") return false;

        // Naming the cutting edges is the run committing to Standard: they were chosen to
        // cut, and there is no reading them as anything else under Quick.
        this.lockMode();

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
            const options = this.modeOptions();
            const handler = new PickEdgeHandler(this.document, this.controller, {
                plan: this.planFor,
                previewColor: this.previewColor,
                options,
            });
            await this.pickWithOptions(handler, this.targetPrompt, this.controller, {
                showControl: false,
                cursor: "select.default",
                options,
            });
            if (this.controller.result?.status !== "success" || !handler.selected) {
                handler.dispose();
                break;
            }
            this.applyPlan(handler.selected);
            // An edge has changed under this mode, so the run is now committed to it -
            // the Quick-mode counterpart of naming the cutting edges.
            this.lockMode();
            handler.dispose();
        }
    }

    /**
     * A pick that also puts its alternatives on the status bar.
     *
     * SnapStep does this for point prompts; a selection prompt goes straight to the
     * picker, which knows about the tip but not the options, so they are published
     * around it here and taken down again whichever way the pick ends.
     */
    private async pickWithOptions(
        handler: IEventHandler,
        prompt: I18nKeys,
        controller: AsyncController,
        pick: { showControl: boolean; cursor: CursorType; options: StepOption[] },
    ) {
        PubSub.default.pub("showStepOptions", pick.options);
        try {
            await this.document.picker.pickAsync(handler, prompt, controller, pick.showControl, pick.cursor);
        } finally {
            PubSub.default.pub("clearStepOptions");
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
