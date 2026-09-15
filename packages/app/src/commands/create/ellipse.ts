import {
    Combobox,
    command,
    Dimensions,
    type GeometryNode,
    type IStep,
    type LengthAtAxisSnapData,
    LengthAtAxisStep,
    LengthAtPlaneStep,
    type PointSnapData,
    PointStep,
    Precision,
    PubSub,
    property,
    type SnapLengthAtPlaneData,
    XYZ,
} from "@draftworks/core";
import { EllipseNode } from "../../bodys/ellipse";
import { CreateCommand } from "../createCommand";

/**
 * How the ellipse is laid out - AutoCAD's ELLIPSE takes either.
 *
 * Axis-End is picked by the two ends of one axis, so the centre falls halfway between
 * them; Center is picked from the middle out. AutoCAD defaults to Axis-End and offers
 * `[Center]` beside it, which is what this follows.
 */
export type EllipseMode = "option.ellipse.mode.axisEnd" | "option.ellipse.mode.center";

@command({
    key: "create.ellipse",
    icon: "icon-ellipse",
})
export class Ellipse extends CreateCommand {
    @property("option.ellipse.mode", {
        combobox: Combobox.from(["option.ellipse.mode.axisEnd", "option.ellipse.mode.center"]),
        // The same letters the prompt takes.
        comboboxKeys: ["", "C"],
    })
    get mode(): EllipseMode {
        return this.getPrivateValue("mode", "option.ellipse.mode.axisEnd" as EllipseMode);
    }
    set mode(value: EllipseMode) {
        // The two modes ask for different things in a different order, so switching has
        // to start the sequence again rather than carry picks across - the same way
        // Circle's mode does.
        this.setProperty("mode", value, () => this.restart());
    }

    getSteps(): IStep[] {
        if (this.mode === "option.ellipse.mode.center") {
            return [
                new PointStep("prompt.ellipse.center", this.getFirstPointData),
                new LengthAtPlaneStep("prompt.ellipse.axisEndpoint", this.getRadius1Data),
                new LengthAtAxisStep("prompt.ellipse.otherAxis", this.getRadius2Data),
            ];
        }
        return [
            new PointStep("prompt.ellipse.axisStart", this.getFirstPointData),
            new PointStep("prompt.ellipse.axisEnd", this.getAxisEndData),
            new LengthAtAxisStep("prompt.ellipse.otherAxis", this.getRadius2Data),
        ];
    }

    /**
     * The first prompt offers the other mode, AutoCAD-style: `Specify axis endpoint of
     * ellipse or [Center]:`. The same setter the panel's dropdown drives, so typing `C`,
     * clicking `C` and choosing it from the panel are three ways into one pipeline.
     */
    private readonly getFirstPointData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        options: () => {
            const toCenter = this.mode === "option.ellipse.mode.axisEnd";
            return [
                {
                    key: toCenter ? "C" : "E",
                    name: toCenter ? "prompt.optionName.center" : "prompt.optionName.axisEnd",
                    display: toCenter ? "prompt.option.center" : "prompt.option.axisEnd",
                    onSelect: () => {
                        this.mode = toCenter ? "option.ellipse.mode.center" : "option.ellipse.mode.axisEnd";
                    },
                },
            ];
        },
    });

    /** Axis-End's second pick: the far end of the first axis, rubber-banded as a line. */
    private readonly getAxisEndData = (): PointSnapData => {
        const start = this.stepDatas[0].point!;
        return {
            refPoint: () => start,
            dimension: Dimensions.D1D2D3,
            validator: (p: XYZ) => p.distanceTo(start) > Precision.Distance,
            preview: (end: XYZ | undefined) =>
                end
                    ? [this.meshPoint(start), this.meshPoint(end), this.meshLine(start, end)]
                    : [this.meshPoint(start)],
        };
    };

    private readonly getRadius1Data = (): SnapLengthAtPlaneData => {
        const point = this.stepDatas[0].point!;
        return {
            point: () => point,
            preview: this.previewCircle,
            plane: (tmp: XYZ | undefined) => this.findPlane(this.stepDatas[0].view, point, tmp),
            validator: this.validatePoint,
        };
    };

    private readonly validatePoint = (point: XYZ) => {
        const center = this.stepDatas[0].point!;
        if (point.distanceTo(center) < Precision.Distance) return false;
        const plane = this.findPlane(this.stepDatas[0].view, center, point);
        return point.sub(center).isParallelTo(plane.normal) === false;
    };

    protected previewCircle = (end: XYZ | undefined) => {
        if (end === undefined) return [this.meshPoint(this.stepDatas[0].point!)];

        const plane = this.findPlane(this.stepDatas[0].view, this.stepDatas[0].point!, end);
        return [
            this.meshPoint(this.stepDatas[0].point!),
            this.meshPoint(end),
            this.meshCreatedShape(
                "circle",
                plane.normal,
                this.stepDatas[0].point!,
                end.distanceTo(this.stepDatas[0].point!),
            ),
        ];
    };

    /**
     * The centre and first axis as the picks so far describe them.
     *
     * Center mode picks the centre outright and then one axis endpoint; Axis-End picks
     * both ends of that axis, which puts the centre halfway between and makes the first
     * radius half the distance. Everything downstream works in centre-and-radius terms,
     * so this is where the two modes become one.
     */
    private firstAxis() {
        const [p0, p1] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        if (this.mode === "option.ellipse.mode.center") {
            return { center: p0, xvec: p1.sub(p0) };
        }
        return { center: XYZ.center(p0, p1), xvec: p1.sub(p0).multiply(0.5) };
    }

    private readonly getRadius2Data = (): LengthAtAxisSnapData => {
        const { center, xvec } = this.firstAxis();
        const plane = this.axisPlane();
        const direction = plane.normal.cross(xvec).normalize()!;
        return {
            point: center,
            preview: this.ellipsePreview,
            direction,
            validator: (p: XYZ) => p.distanceTo(center) > Precision.Distance,
        };
    };

    /**
     * The plane the ellipse is drawn on. Center mode is handed one by its length step;
     * Axis-End picks two plain points, so it is worked out from them the same way every
     * other 2D command does.
     */
    private axisPlane() {
        if (this.mode === "option.ellipse.mode.center") {
            return (
                this.stepDatas[1].plane ??
                this.findPlane(this.stepDatas[0].view, this.stepDatas[0].point!, this.stepDatas[1].point!)
            );
        }
        return this.findPlane(this.stepDatas[0].view, this.stepDatas[0].point!, this.stepDatas[1].point!);
    }

    /** Centre, axis direction and the two radii - what the node and the preview both need. */
    private ellipseData(second: XYZ) {
        const { center, xvec } = this.firstAxis();
        const plane = this.axisPlane();

        const major = xvec.length();
        const minor = plane.projectDistance(center, second);
        return {
            normal: plane.normal,
            center,
            xvec,
            // The kernel takes the larger radius first, so a minor axis picked longer
            // than the major is held back rather than inverting the ellipse.
            majorRadius: major,
            minorRadius: minor > major ? major : minor,
        };
    }

    protected override geometryNode(): GeometryNode {
        const data = this.ellipseData(this.stepDatas[2].point!);
        return new EllipseNode({ document: this.document, ...data });
    }

    private readonly ellipsePreview = (point: XYZ | undefined) => {
        if (!point) return this.previewCircle(this.stepDatas[1].point);

        return [
            this.meshPoint(this.stepDatas[0].point!),
            this.meshPoint(this.stepDatas[1].point!),
            this.createEllipse(point),
        ];
    };

    private createEllipse(p2: XYZ) {
        const { normal, center, xvec, majorRadius, minorRadius } = this.ellipseData(p2);
        return this.meshCreatedShape("ellipse", normal, center, xvec, majorRadius, minorRadius);
    }
}
