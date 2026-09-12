import type { IDisposable } from "../foundation";
import type { Matrix4 } from "../math";

export type GeometryType = "curve" | "surface";

export interface IGeometry extends IDisposable {
    get geometryType(): GeometryType;
    transform(matrix: Matrix4): void;
    transformed(matrix: Matrix4): IGeometry;
    copy(): IGeometry;
}
