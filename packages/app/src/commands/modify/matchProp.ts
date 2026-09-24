import {
    Annotation,
    AsyncController,
    command,
    DimensionAnnotation,
    GeometryNode,
    type INode,
    type IStep,
    MultiStepCommand,
    SelectNodeStep,
    ShapeTypes,
    TextAnnotation,
    Transaction,
    VisualNode,
    VisualStates,
} from "@draftworks/core";

/**
 * AutoCAD's MATCHPROP (MA):
 *
 *     Select source object:
 *     Select destination object(s) or [Settings]:
 *
 * One object is nominated as the look to copy, and every object picked after it takes
 * that look on. Nothing about an object's geometry moves - MATCHPROP only ever changes
 * how a thing is drawn, never what it is - which is what makes it the fast way to fix
 * a handful of lines drawn on the wrong layer, or in last week's colour, without
 * opening the properties panel once per object.
 *
 * As in AutoCAD, each destination pick is applied the moment it is made and the prompt
 * comes straight back for the next one, until Enter or Escape. Batching them all up
 * behind a final Enter left the drawing unchanged after every click, which reads as the
 * command not working at all. The source stays highlighted throughout, so it is always
 * clear which object is being copied.
 *
 * What travels:
 *
 *   - every object: layer.
 *   - geometry onto geometry: colour (the node's material) and linetype - this app's
 *     whole set of "how it's drawn" properties, matching AutoCAD's basic-properties group.
 *   - annotation onto annotation: colour.
 *   - dimension onto dimension: the dimension style - AutoCAD's Dimension special
 *     property. A dimension's line, arrow and text colours all come from its style, so
 *     without this matching two dimensions changed nothing visible.
 *   - text onto text: the text height - AutoCAD's Text special property.
 *
 * What does not, and why:
 *
 *   - `filled`: whether a shape is painted as a region or drawn as an outline is closer
 *     to what kind of object it is than to how it looks - a HATCH is filled, a circle is
 *     a ring - and AutoCAD likewise treats hatch-ness as a special property rather than a
 *     basic one. Matching a hatch onto a circle should not turn the circle into a disc.
 *   - per-face colour overrides: those index into the target's own face list, so a source
 *     object's face 3 means nothing on a target with different topology. The target's
 *     overrides are cleared instead, so the copied colour actually shows - colour is an
 *     object-level property in AutoCAD too.
 */
@command({
    key: "modify.matchProp",
    icon: "icon-matchProp",
})
export class MatchProp extends MultiStepCommand {
    protected override getSteps(): IStep[] {
        return [new SelectNodeStep("prompt.matchProp.source")];
    }

    protected override async executeAsync(): Promise<void> {
        // Noun-verb: a single object already selected when MA starts is the source, the
        // way AutoCAD takes it, rather than being thrown away and asked for again.
        const preselected = this.document.selection.getSelectedVisualNodes();
        const view = this.application.activeView;
        if (view && preselected.length === 1 && this.stepDatas.length === 0) {
            this.stepDatas.push({
                view,
                shapes: [],
                nodes: preselected,
                type: "node",
            });
        }

        if (!(await this.executeSteps())) return;

        const source = this.stepDatas[0].nodes?.at(0);
        if (!source) return;

        const visual = this.document.visual.context.getVisual(source);
        const markSource = (on: boolean) => {
            if (!visual) return;
            const highlighter = this.document.visual.highlighter;
            if (on) highlighter.addState(visual, VisualStates.edgeSelected, ShapeTypes.shape);
            else highlighter.removeState(visual, VisualStates.edgeSelected, ShapeTypes.shape);
            this.document.visual.update();
        };

        markSource(true);
        try {
            await this.pickDestinations(source);
        } finally {
            markSource(false);
        }
    }

    private async pickDestinations(source: VisualNode) {
        // The source is filtered out of the pick rather than dropped afterwards: matching
        // it onto itself would still cost an undo entry, and picking it would take its
        // highlight away.
        const notSource = { allow: (node: INode) => node !== source };

        while (!this.isCanceled) {
            this.controller = new AsyncController();
            const picked = await this.document.picker.pickNode(
                "prompt.matchProp.destination",
                this.controller,
                {
                    multi: true,
                    nodeFilter: notSource,
                    // Each click or window is applied on its own, then the prompt repeats.
                    canFinish: (selected) => selected.length > 0,
                    // Nothing accumulates, so a selection count would sit at 0.
                    showControl: false,
                },
            );
            const accepted = this.controller.result?.status === "success";
            this.document.selection.clearSelection();

            const destinations = picked.filter(
                (x): x is VisualNode => x instanceof VisualNode && x !== source,
            );
            if (destinations.length > 0) this.applyAll(source, destinations);

            // Enter on an empty pick ends the command, as does Escape.
            if (!accepted || picked.length === 0) return;
        }
    }

    protected override executeMainTask(): void {
        // Destinations are applied pick by pick in executeAsync.
    }

    private applyAll(source: VisualNode, destinations: VisualNode[]) {
        Transaction.execute(this.document, "match properties", () => {
            for (const destination of destinations) this.applyTo(source, destination);
        });
        this.document.visual.update();
    }

    private applyTo(source: VisualNode, destination: VisualNode) {
        destination.layerId = source.layerId;

        if (source instanceof GeometryNode && destination instanceof GeometryNode) {
            this.applyGeometry(source, destination);
        } else if (source instanceof Annotation && destination instanceof Annotation) {
            this.applyAnnotation(source, destination);
        }
        // Anything else - a FolderNode, or geometry matched onto an annotation - shares
        // no property beyond the layer, and is matched by layer alone.
    }

    private applyGeometry(source: GeometryNode, destination: GeometryNode) {
        destination.lineType = source.lineType;

        if (destination.faceMaterialPair.length > 0 || Array.isArray(destination.materialId)) {
            destination.clearFaceMaterial();
        }
        destination.materialId = this.baseMaterialOf(source);
    }

    private applyAnnotation(source: Annotation, destination: Annotation) {
        destination.color = source.color;

        if (source instanceof DimensionAnnotation && destination instanceof DimensionAnnotation) {
            // Undefined is copied too: a source that follows the current style makes the
            // destination follow it as well.
            destination.styleName = source.styleName;
        } else if (source instanceof TextAnnotation && destination instanceof TextAnnotation) {
            destination.height = source.height;
        }
    }

    /** A source painted face by face still has one underlying colour - the first. */
    private baseMaterialOf(source: GeometryNode): string {
        return Array.isArray(source.materialId) ? source.materialId[0] : source.materialId;
    }
}
