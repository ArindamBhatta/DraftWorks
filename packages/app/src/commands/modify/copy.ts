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

@command({
    key: "modify.copy",
    icon: "icon-copy",
})
export class Copy extends TransformedCommand {
    /** COPY always keeps the source; nothing can set this to false. */

    override get isClone() {
        return true;
    }

    override set isClone(_value: boolean) {
        // No-op: see class doc. The setter still exists because the base
        // class's @property accessor pair expects one.
    }
    //Private
    #displacementMode = false;

    getSteps(): IStep[] {
        if (this.#displacementMode) {
            return [new PointStep("prompt.copy.displacement", this.getDisplacementData, true)];
        }
    }

    private readonly getDisplacementData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        preview: (point: XYZ | undefined) => (point ? [this.transformPreview(point)] : []),
    });
}
