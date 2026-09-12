import {
    command,
    Dimensions,
    type IStep,
    Matrix4,
    type PointSnapData,
    PointStep,
    Precision,
    type ShapeMeshData,
    type StepOption,
    type XYZ,
} from "@draftworks/core";
import { TransformedCommand } from "./transformedCommand";

/**
 * AutoCAD's SCALE:
 *
 *     Select objects:
 *     Specify base point:
 *     Specify scale factor or [Copy/Reference] <1.0000>:
 *
 * The base point is the one point that does not move - everything else closes in on
 * it or spreads away from it - and the factor is uniform on every axis, so a scaled
 * drawing keeps its proportions and its angles.
 *
 * The factor prompt reads the pick as a bare distance from the base point, which is
 * AutoCAD's own (initially surprising) rule: clicking two units away scales by two,
 * not by "twice the distance to wherever you started". That is also what makes a
 * typed factor and a picked factor mean the same thing, so "scale by 2" is just `2`.
 *
 * Reference covers the case the raw factor cannot express - "this wall is 3.4 long
 * and needs to be 5" - by taking a ratio of two lengths measured from the base point
 * instead of one absolute number. Copy leaves the original where it is and scales a
 * duplicate, the same toggle Rotate offers.
 */
@command({
    key: "modify.scale",
    icon: "icon-scale",
})
export class Scale extends TransformedCommand {
    #referenceMode = false;
    /** Set when a restart must not throw away the base point the user already gave. */
    #keepBasePoint = false;

    getSteps(): IStep[] {
        const basePoint = new PointStep("prompt.scale.basePoint", this.getBasePointData, true);

        if (this.#referenceMode) {
            return [
                basePoint,
                new PointStep("prompt.scale.referenceLength", this.getReferenceLengthData, true),
                new PointStep("prompt.scale.newLength", this.getNewLengthData, true),
            ];
        }

        return [basePoint, new PointStep("prompt.scale.factor", this.getFactorData, true)];
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

    private readonly getBasePointData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
    });

    // ------------------------------------------------------------- the factor

    private readonly getFactorData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2D3,
        preview: this.scalePreview,
        options: this.#factorOptions,
        validator: this.isAwayFromBase,
    });

    readonly #factorOptions = (): StepOption[] => {
        const options: StepOption[] = [
            {
                key: "C",
                name: "prompt.optionName.copy",
                display: this.isClone ? "prompt.option.scaleInPlace" : "prompt.option.scaleCopy",
                onSelect: () => {
                    this.isClone = !this.isClone;
                },
            },
        ];
        if (!this.#referenceMode) {
            options.push({
                key: "R",
                name: "prompt.optionName.reference",
                display: "prompt.option.scaleReference",
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

    private readonly getReferenceLengthData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2D3,
        preview: (point: XYZ | undefined) => {
            const base = this.meshPoint(this.stepDatas[0].point!);
            if (!point) return [base];
            return [base, this.getTempLineData(this.stepDatas[0].point!, point)];
        },
        validator: this.isAwayFromBase,
    });

    private readonly getNewLengthData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2D3,
        preview: this.scalePreview,
        options: this.#factorOptions,
        validator: this.isAwayFromBase,
    });

    // ------------------------------------------------------------ the result

    /**
     * A zero-length pick would scale everything to nothing (and, in Reference mode,
     * divide by zero), so both lengths have to be a real distance from the base.
     */
    private readonly isAwayFromBase = (point: XYZ) =>
        point.distanceTo(this.stepDatas[0].point!) > Precision.Distance;

    /**
     * How much bigger: the bare distance from the base point in the default mode,
     * and the ratio of the new length to the nominated reference length otherwise.
     */
    private getScaleFactor(point: XYZ): number {
        const base = this.stepDatas[0].point!;
        if (this.#referenceMode) {
            return point.distanceTo(base) / this.stepDatas[1].point!.distanceTo(base);
        }
        return point.distanceTo(base);
    }

    protected override transfrom(point: XYZ): Matrix4 {
        const base = this.stepDatas[0].point!;
        const factor = this.getScaleFactor(point);
        // Scale about the base point: bring it to the origin, scale there, put it back.
        // `A.multiply(B)` applies B first, so this reads right to left.
        return Matrix4.fromTranslation(base.x, base.y, base.z)
            .multiply(Matrix4.fromScale(factor, factor, factor))
            .multiply(Matrix4.fromTranslation(-base.x, -base.y, -base.z));
    }

    private readonly scalePreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const base = this.meshPoint(this.stepDatas[0].point!);
        if (!point) return [base];
        return [base, this.transformPreview(point), this.getTempLineData(this.stepDatas[0].point!, point)];
    };
}
