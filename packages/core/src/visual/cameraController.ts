import type { IDisposable, IPropertyChanged } from "../foundation";
import type { XYZ, XYZLike } from "../math";

/**
 * The camera is orthographic-only and cannot orbit: this is a 2D drafting app, so the
 * view stays a fixed plan projection and only pans, zooms and fits.
 */
export interface ICameraController extends IPropertyChanged, IDisposable {
    readonly cameraPosition: XYZ;
    readonly cameraTarget: XYZ;
    readonly cameraUp: XYZ;

    fitContent(): void;
    lookAt(eye: XYZLike, target: XYZLike, up: XYZLike): void;
    pan(dx: number, dy: number): void;
    zoom(x: number, y: number, delta: number): void;
    updateCameraPosionTarget(): void;
}
