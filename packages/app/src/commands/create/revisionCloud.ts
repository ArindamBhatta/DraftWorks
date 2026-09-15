import {
    AsyncController,
    command,
    Dimensions,
    type GeometryNode,
    I18n,
    type IStep,
    type PointSnapData,
    PointStep,
    Precision,
    property,
    type ShapeMeshData,
    type SnapResult,
    type XYZ,
} from "@draftworks/core";

import { cloudArcs, RevisionCloudNode } from "../../bodys/revisionCloud";

import { CreateCommand } from "../createCommand";

/**
 * AutoCAD's REVCLOUD: a chain of arc bulges ringing the part of a drawing that has
 * changed. Picked like a polyline - click round the area, and clicking back on the first
 * point closes it - with the scallops derived from the path rather than picked (see
 * RevisionCloudNode).
 *
 * Closing is what ends the command, and it is also the usual thing to want: a cloud that
 * does not close is a mark-up that rings nothing. Finishing on Enter is still allowed,
 * because an arc chain along an open path is a legitimate (if rarer) mark-up, and because
 * refusing to end the command is a worse answer than drawing what was picked.
 */
@command({
    key: "create.revisionCloud",
    icon: "icon-revisionCloud",
})
export class RevisionCloud extends CreateCommand {
    @property("common.confirm")
    readonly confirm = () => {
        this.controller?.success();
    };

    /**
     * The nominal scallop size. Each straight run divides into whole arcs near this
     * length rather than a whole number of them plus a stub, so this reads as "about
     * this big" - which is how REVCLOUD's own arc length behaves.
     */
    @property("revisionCloud.arcLength", { type: "length" })
    get arcLength(): number {
        return this.getPrivateValue("arcLength", 15);
    }
    set arcLength(value: number) {
        this.setProperty("arcLength", Math.max(value, 0.1));
    }

    protected override geometryNode(): GeometryNode {
        return new RevisionCloudNode({
            document: this.document,
            points: this.pathPoints(),
            normal: this.normal(),
            arcLength: this.arcLength,
        });
    }

    /**
     * The picked path, wound so the scallops bulge outward.
     *
     * The arcs are built to the left of the path (see cloudArcs), so a path picked
     * clockwise would scallop into the region it is meant to ring. Rather than offer
     * REVCLOUD's Reverse option, the winding is measured and the path flipped when it
     * comes out clockwise - the direction a user circles an area in is not a choice they
     * are making about the cloud, so it should not be one they have to correct.
     */
    private pathPoints(): XYZ[] {
        const points = this.stepDatas.map((step) => step.point!);
        if (this.isClosedPath(points)) {
            return this.signedArea(points) < 0 ? [...points].reverse() : points;
        }
        return points;
    }

    /** A path is closed when the last pick landed back on the first - see isClose. */
    private isClosedPath(points: XYZ[]): boolean {
        return points.length > 2 && points[0].distanceTo(points.at(-1)!) <= Precision.Distance;
    }

    /**
     * Twice the area the closed path encloses, signed - negative when it winds clockwise
     * about the drawing plane's normal. Measured by the shoelace sum projected onto that
     * normal, so it holds on a workplane at any orientation, not just the XY one.
     */
    private signedArea(points: XYZ[]): number {
        const normal = this.normal();
        let total = 0;
        for (let i = 0; i < points.length - 1; i++) {
            total += points[i].cross(points[i + 1]).dot(normal);
        }
        return total;
    }

    /** The plane the cloud is drawn on - the view's workplane, as the other 2D tools use. */
    private normal(): XYZ {
        return this.stepDatas[0].view.workplane.normal;
    }

    /**
     * Picks until the path closes or the user confirms, the way Polygon's loop does - a
     * cloud has no fixed number of points, so the second step is re-run rather than a
     * third step existing.
     */
    protected override async executeSteps(): Promise<boolean> {
        const steps = this.getSteps();
        let firstStep = true;
        while (true) {
            const step = firstStep ? steps[0] : steps[1];
            if (firstStep) firstStep = false;
            this.controller = new AsyncController();
            const data = await step.execute(this.document, this.controller);
            if (data === undefined) {
                // Ended on Enter/right-click rather than a pick. Two points describe a
                // single run of scallops and are enough to draw; one is not.
                return this.controller.result?.status === "success" && this.stepDatas.length > 1;
            }
            this.stepDatas.push(data);
            if (this.isClose(data)) {
                return true;
            }
        }
    }

    private isClose(data: SnapResult): boolean {
        return (
            this.stepDatas.length > 2 &&
            this.stepDatas[0].point!.distanceTo(data.point!) <= Precision.Distance
        );
    }

    protected override getSteps(): IStep[] {
        const firstStep = new PointStep("prompt.pickFistPoint");
        const secondStep = new PointStep("prompt.pickNextPoint", this.getNextData);
        return [firstStep, secondStep];
    }

    private readonly getNextData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas.at(-1)!.point!,
            dimension: Dimensions.D1D2D3,
            validator: this.validator,
            preview: this.preview,
            featurePoints: [
                {
                    point: this.stepDatas.at(0)!.point!,
                    prompt: I18n.translate("prompt.revisionCloud.close"),
                    when: () => this.stepDatas.length > 2,
                },
            ],
        };
    };

    /**
     * Rubber-bands the scallops themselves, not the path they hang off: the arcs are what
     * is being placed, and their size is a setting the user may be about to change.
     */
    private readonly preview = (point: XYZ | undefined): ShapeMeshData[] => {
        const points = this.stepDatas.map((data) => data.point!);
        if (point) points.push(point);

        const marks = this.stepDatas.map((data) => this.meshPoint(data.point!));
        if (points.length < 2) return marks;

        const arcs = cloudArcs(points, this.normal(), this.arcLength);
        if (!arcs.isOk) return marks;

        return [...marks, ...arcs.value.map((edge) => this.meshShape(edge))];
    };

    private readonly validator = (point: XYZ): boolean => {
        // Every pick but a deliberate close has to advance the path; a repeat would
        // contribute a run of no length and no arcs.
        const last = this.stepDatas.at(-1)!.point!;
        if (point.distanceTo(last) <= Precision.Distance) return false;

        if (this.stepDatas.length > 2) return true;
        return point.distanceTo(this.stepDatas[0].point!) > Precision.Distance;
    };
}
