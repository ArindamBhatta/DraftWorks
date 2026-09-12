import {
    AngleStep,
    command,
    Dimensions,
    type IStep,
    Matrix4,
    type Plane,
    type PointSnapData,
    PointStep,
    Precision,
    type ShapeMeshData,
    type StepOption,
    type XYZ,
} from "@draftworks/core";
import { TransformedCommand } from "./transformedCommand";

/**
 * AutoCAD's ROTATE:
 *
 *     Select objects:
 *     Specify base point:
 *     Specify rotation angle or [Copy/Reference] <0>:
 *
 * Two picks, not three. This used to ask for a base point, then a second point that
 * did nothing but define where zero degrees was, and only then the angle - so typing
 * "rotate 90 degrees", the commonest thing anyone does with this command, was
 * impossible without first inventing a reference direction. Zero degrees is now due
 * east of the base point, as it is in AutoCAD, and the angle can simply be typed.
 *
 * Reference brings the old behaviour back where it belongs: as the option for "turn
 * this from whatever angle it is at now to that angle instead", which is the case
 * that genuinely needs two directions.
 */
@command({
    key: "modify.rotate",
    icon: "icon-rotate",
})
export class Rotate extends TransformedCommand {
    #referenceMode = false;
    /** Set when a restart must not throw away the base point the user already gave. */
    #keepBasePoint = false;

    getSteps(): IStep[] {
        const basePoint = new PointStep("prompt.rotate.basePoint", this.getBasePointData, true);
        const center = () => this.stepDatas[0].point!;

        if (this.#referenceMode) {
            return [
                basePoint,
                new PointStep("prompt.rotate.referenceAngle", this.getReferenceData, true),
                new AngleStep(
                    "prompt.rotate.newAngle",
                    center,
                    () => this.stepDatas[1].point!,
                    this.getAngleData,
                    true,
                ),
            ];
        }

        return [
            basePoint,
            // Zero degrees is due east of the base point - AutoCAD's convention, and
            // what makes a typed angle mean what the user expects.
            new AngleStep(
                "prompt.rotate.angle",
                center,
                () => center().add(this.rotationPlane().xvec),
                this.getAngleData,
                true,
            ),
        ];
    }

    protected override resetStepDatas() {
        if (this.#keepBasePoint) {
            // Choosing Reference restarts the command to swap in the longer step
            // sequence; AutoCAD does not re-ask for the base point, so nor do we.
            this.#keepBasePoint = false;
            this.stepDatas.length = 1;
            return;
        }
        super.resetStepDatas();
    }

    /** Always the drawing plane: a 2D view turns things about its own normal. */
    private rotationPlane(): Plane {
        return this.findPlane(this.stepDatas[0].view, this.stepDatas[0].point!, undefined);
    }

    private readonly getBasePointData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
    });

    // ------------------------------------------------------------- the angle

    private readonly getAngleData = (): PointSnapData => ({
        dimension: Dimensions.D1D2,
        preview: this.anglePreview,
        plane: () => this.rotationPlane(),
        options: this.#angleOptions,
        validator: (p) => p.distanceTo(this.stepDatas[0].point!) > Precision.Distance,
    });

    readonly #angleOptions = (): StepOption[] => {
        const options: StepOption[] = [
            {
                key: "C",
                name: "prompt.optionName.copy",
                display: this.isClone ? "prompt.option.rotateInPlace" : "prompt.option.copy",
                onSelect: () => {
                    this.isClone = !this.isClone;
                },
            },
        ];
        if (!this.#referenceMode) {
            options.push({
                key: "R",
                name: "prompt.optionName.reference",
                display: "prompt.option.reference",
                onSelect: () => {
                    this.#referenceMode = true;
                    this.#keepBasePoint = true;
                    this.restart();
                },
            });
        }
        return options;
    };

    // --------------------------------------------------------- Reference mode

    private readonly getReferenceData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2,
        preview: (point: XYZ | undefined) => {
            const center = this.meshPoint(this.stepDatas[0].point!);
            if (!point) return [center];
            return [center, this.getRayData(point)];
        },
        validator: (p) => p.distanceTo(this.stepDatas[0].point!) > Precision.Distance,
    });

    // ------------------------------------------------------------ the result

    /**
     * How far to turn: from the zero direction to the cursor. In the default mode
     * zero is due east, so a picked or typed angle is absolute; in Reference mode
     * zero is the direction the user nominated, so the same reading becomes "from
     * there to here".
     */
    private getAngle(point: XYZ) {
        const plane = this.rotationPlane();
        const center = this.stepDatas[0].point!;
        const from = this.#referenceMode ? this.stepDatas[1].point!.sub(center) : plane.xvec;
        return from.angleOnPlaneTo(point.sub(center), plane.normal)!;
    }

    protected override transfrom(point: XYZ): Matrix4 {
        const plane = this.rotationPlane();
        return Matrix4.fromAxisRad(this.stepDatas[0].point!, plane.normal, this.getAngle(point));
    }

    private readonly anglePreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const center = this.stepDatas[0].point!;
        if (!point) return [this.meshPoint(center)];

        const zeroAt = this.#referenceMode ? this.stepDatas[1].point! : center.add(this.rotationPlane().xvec);
        const result = [
            this.transformPreview(point),
            this.meshPoint(center),
            this.getRayData(zeroAt),
            this.getRayData(point),
        ];

        const angle = this.getAngle(point);
        if (Math.abs(angle) > Precision.Angle) {
            result.push(
                this.meshCreatedShape(
                    "arc",
                    this.rotationPlane().normal,
                    center,
                    zeroAt,
                    (angle * 180) / Math.PI,
                ),
            );
        }
        return result;
    };

    private getRayData(end: XYZ) {
        const center = this.stepDatas[0].point!;
        const direction = end.sub(center).normalize();
        if (!direction) return this.getTempLineData(center, end);
        return this.getTempLineData(center, center.add(direction.multiply(1e6)));
    }
}
