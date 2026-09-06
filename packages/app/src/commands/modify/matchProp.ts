// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    GeometryNode,
    type IStep,
    MultiStepCommand,
    SelectNodeStep,
    Transaction,
    type VisualNode,
} from "@chili3d/core";

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
 * What travels: layer, colour (the node's material) and linetype - this app's whole
 * set of "how it's drawn" properties, matching AutoCAD's basic-properties group.
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
        return [
            new SelectNodeStep("prompt.matchProp.source"),
            new SelectNodeStep("prompt.matchProp.destination", { multiple: true }),
        ];
    }

    protected override executeMainTask(): void {
        const source = this.stepDatas[0].nodes?.at(0);
        if (!source) return;

        // Picking the source again among the destinations is a no-op that would still
        // cost an undo entry, so it is dropped rather than applied to itself.
        const destinations = (this.stepDatas[1].nodes ?? []).filter((x) => x !== source);
        if (destinations.length === 0) return;

        Transaction.execute(this.document, "match properties", () => {
            destinations.forEach((destination) => this.applyTo(source, destination));
        });

        this.document.visual.update();
    }

    private applyTo(source: VisualNode, destination: VisualNode) {
        destination.layerId = source.layerId;

        // Colour and linetype live on GeometryNode - a FolderNode has neither, and is
        // matched by layer alone.
        if (!(source instanceof GeometryNode) || !(destination instanceof GeometryNode)) return;

        destination.lineType = source.lineType;

        if (destination.faceMaterialPair.length > 0 || Array.isArray(destination.materialId)) {
            destination.clearFaceMaterial();
        }
        destination.materialId = this.baseMaterialOf(source);
    }

    /** A source painted face by face still has one underlying colour - the first. */
    private baseMaterialOf(source: GeometryNode): string {
        return Array.isArray(source.materialId) ? source.materialId[0] : source.materialId;
    }
}
