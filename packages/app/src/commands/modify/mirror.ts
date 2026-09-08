import {
    command,
    Dimensions,
    type IStep,
    Matrix4,
    Plane,
    type PointSnapData,
    PointStep,
    Precision,
    PubSub,
    type ShapeMeshData,
    type StepOption,
    type XYZ,
} from "@chili3d/core";
import { TransformedCommand } from "./transformedCommand";

/**
 * AutoCAD's MIRROR:
 *
 *     Select objects:
 *     Specify first point of mirror line:
 *     Specify second point of mirror line:
 *     Erase source objects? [Yes/No] <N>:
 *
 * That last answer defaults to No, and it is the whole point of the command: you
 * mirror something to get a second copy facing the other way. This used to inherit
 * TransformedCommand's default of transforming in place, so MIRROR flipped the
 * original across the line and left you with one object instead of two - the
 * opposite of what every draftsman expects. It now keeps the source by default and
 * offers Erase as the option, exactly as AutoCAD asks it.
 */
@command({
    key: "modify.mirror",
    icon: "icon-mirror",
})
export class Mirror extends TransformedCommand {
    /**
     * Mirroring keeps the original unless asked otherwise, so this flips
     * TransformedCommand's default. Safe to differ now that the command property
     * cache is keyed per command (see CancelableCommand.cacheKeyOfProperty) - before
     * that, running MOVE would have overwritten this with MOVE's answer.
     */
    override get isClone() {
        return this.getPrivateValue("isClone", true);
    }
    override set isClone(value: boolean) {
        this.setProperty("isClone", value, () => PubSub.default.pub("refreshStepPrompt"));
    }

    protected override transfrom(point: XYZ): Matrix4 {
        return Matrix4.createMirrorWithPlane(this.mirrorPlane(point));
    }

    /**
     * The plane to reflect in: it stands on the mirror line and rises out of the
     * drawing, so reflecting in it is the 2D flip across that line.
     */
    private mirrorPlane(point: XYZ): Plane {
        const start = this.stepDatas[0].point!;
        const xvec = this.stepDatas[0].view.workplane.normal;
        const normal = point.sub(start).cross(xvec);
        return new Plane({ origin: start, normal, xvec });
    }

    getSteps(): IStep[] {
        return [
            new PointStep("prompt.mirror.firstPoint", this.getFirstPointData, true),
            new PointStep("prompt.mirror.secondPoint", this.getSecondPointData, true),
        ];
    }

    private readonly getFirstPointData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
    });

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimensions.D1D2,
            preview: this.mirrorPreview,
            options: this.#eraseOptions,
            validator: (p) => {
                const vec = p.sub(this.stepDatas[0].point!);
                return (
                    vec.length() > Precision.Distance &&
                    !vec.isParallelTo(this.stepDatas[0].view.workplane.normal)
                );
            },
        };
    };

    /** AutoCAD's "Erase source objects? [Yes/No]", offered as the running answer. */
    readonly #eraseOptions = (): StepOption[] => [
        {
            key: "E",
            name: "prompt.optionName.erase",
            display: this.isClone ? "prompt.option.eraseSource" : "prompt.option.keepSource",
            onSelect: () => {
                this.isClone = !this.isClone;
            },
        },
    ];

    private readonly mirrorPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const start = this.stepDatas[0].point!;
        const p1 = this.meshPoint(start);
        if (!point) return [p1];

        const direction = point.sub(start).normalize();
        if (!direction) return [p1];

        // The mirror line is drawn well past both picks, so it reads as the axis the
        // reflection happens about rather than as a segment between two dots.
        const offset = direction.multiply(1e6);
        return [p1, this.transformPreview(point), this.getTempLineData(start.sub(offset), start.add(offset))];
    };
}
