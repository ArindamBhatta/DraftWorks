import type { XYZ } from "../../math";
import type { IEqualityComparer } from "../equalityComparer";
import { Precision } from "../precision";

export class XYZEqualityComparer implements IEqualityComparer<XYZ> {
    constructor(readonly tolerance: number = Precision.Distance) {}

    equals(left: XYZ, right: XYZ): boolean {
        return left.isEqualTo(right, this.tolerance);
    }
}
