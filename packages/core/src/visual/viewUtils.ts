import { Precision } from "../foundation";
import { Line, Plane, type XYZ } from "../math";
import type { IView } from "./view";

export class ViewUtils {
    // The camera is always orthographic (see ICameraController), so an eye ray is
    // always the view direction through the point - there is no perspective branch.
    static rayFromEye(view: IView, point: XYZ) {
        const direction = view.direction();
        const dot = point.sub(view.cameraController.cameraPosition).dot(direction);
        const location = point.sub(direction.multiply(dot));
        return new Line({ point: location, direction });
    }

    static ensurePlane(view: IView, plane: Plane) {
        const direction = view.direction();
        if (Math.abs(direction.dot(plane.normal)) < Precision.Float) {
            const left = direction.cross(view.up());
            return new Plane({ origin: plane.origin, normal: direction, xvec: left });
        }
        return plane;
    }
}
