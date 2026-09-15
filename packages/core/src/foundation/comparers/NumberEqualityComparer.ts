import type { IEqualityComparer } from "../equalityComparer";
import { Precision } from "../precision";

export class NumberEqualityComparer implements IEqualityComparer<number> {
    constructor(readonly tolerance: number = Precision.Distance) {}

    equals(left: number, right: number): boolean {
        return Math.abs(left - right) < this.tolerance;
    }
}
