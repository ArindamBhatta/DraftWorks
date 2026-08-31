import {
    command,
    Dimensions,
    type IStep,
    Matrix4,
    type PointSnapData,
    PointStep,
    type StepOption,
    type XYZ,
} from "@chili3d/core";
import { TransformedCommand } from "./transformedCommand";

/**
 * AutoCAD's MOVE:
 *
 *     Select objects:                                   (pickbox, Enter to finish)
 *     Specify base point or [Displacement]:
 *     Specify second point or <use first point as displacement>:
 *
 * The selection phase is inherited from TransformedCommand - it shows the bare
 * pickbox cursor, since at that prompt you are picking objects rather than aiming at
 * a point.
 *
 * Displacement is the one option MOVE offers, and it changes what the *next* pick
 * means rather than how objects are chosen: instead of "from here to there", the
 * point you give is read as the shift itself, measured from the origin. Entering
 * `10,0` in displacement mode moves the selection ten units along x wherever it
 * happens to sit, which is how a draftsman nudges something by an exact amount
 * without needing a feature on the drawing to measure from.
 */
@command({
    key: "modify.move",
    icon: "icon-move",
})
export class Move extends TransformedCommand {
    /** True once the user has answered the base-point prompt with `D`. */
    #displacementMode = false;

    getSteps(): IStep[] {
        if (this.#displacementMode) {
            return [new PointStep("prompt.move.displacement", this.getDisplacementData, true)];
        }
        return [
            new PointStep("prompt.move.basePoint", this.getBasePointData, true),
            new PointStep("prompt.move.secondPoint", this.getSecondPointData, true),
        ];
    }

    // Deliberately no resetStepDatas override: choosing Displacement restarts the
    // command, and restarting runs resetStepDatas - clearing the flag there would
    // undo the very choice that triggered the restart. The flag is per-invocation
    // anyway, since a fresh command instance is built each time MOVE is run.

    private readonly getBasePointData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        options: this.#baseOptions,
    });

    readonly #baseOptions = (): StepOption[] => [
        {
            key: "D",
            display: "prompt.option.displacement",
            onSelect: () => {
                this.#displacementMode = true;
                this.restart();
            },
        },
    ];

    /**
     * In displacement mode the single point is the shift itself, so it is previewed
     * and applied as an offset from the origin rather than from a picked base.
     */
    private readonly getDisplacementData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        preview: (point: XYZ | undefined) => (point ? [this.transformPreview(point)] : []),
    });

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimensions.D1D2D3,
            preview: this.movePreview,
        };
    };

    private readonly movePreview = (point: XYZ | undefined) => {
        const p1 = this.meshPoint(this.stepDatas[0].point!);
        if (!point) return [p1];
        return [p1, this.transformPreview(point), this.getTempLineData(this.stepDatas[0].point!, point)];
    };

    protected override transfrom(point: XYZ): Matrix4 {
        // Displacement mode has no base point to subtract - the point IS the shift.
        const { x, y, z } = this.#displacementMode ? point : point.sub(this.stepDatas[0].point!);
        return Matrix4.fromTranslation(x, y, z);
    }
}
