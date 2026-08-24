// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ICameraController, Observable, type ViewMode, type XYZLike } from "@chili3d/core";
import { Box3, Camera, OrthographicCamera, Raycaster, Sphere, Vector3 } from "three";
import { Constants } from "./constants";
import type { ThreeGeometry } from "./threeGeometry";
import { ThreeHelper } from "./threeHelper";
import type { ThreeView } from "./threeView";
import type { ThreeVisualContext } from "./threeVisualContext";

const DEG_TO_RAD = Math.PI / 180.0;
const ZOOM_SPEED_FACTOR = 0.1;
const PAN_SPEED_FACTOR = 0.002;
// Half-angle of the frustum the orthographic view is sized from. There is no
// perspective camera any more (this is a 2D drafting app - the view is locked to a
// plan projection), so this is purely the constant that converts camera distance into
// the orthographic frustum height; it is not a lens.
const FRUSTUM_FOV = 50;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1e6;
const MIN_CARME_TO_TARGET = 50;
const SHAPE_EMPTY_SIZE = 800;

Camera.DEFAULT_UP = new Vector3(0, 0, 1);

/**
 * Orthographic-only camera. The old free-orbit controls (perspective camera,
 * startRotate/rotate, rotate-center tracking) are gone: a 2D drafting view only ever
 * pans, zooms and fits, so the projection stays a fixed plan view.
 */
export class CameraController extends Observable implements ICameraController {
    private _width: number = 100;
    private _height: number = 100;
    private _target: Vector3 = new Vector3();
    private _position: Vector3 = new Vector3(0, 1000, 0);
    private _camera: OrthographicCamera;

    get target() {
        return this._target;
    }

    set target(value: Vector3) {
        this._target.copy(value);
    }

    get cameraPosition() {
        return ThreeHelper.toXYZ(this._position);
    }

    get cameraTarget() {
        return ThreeHelper.toXYZ(this._target);
    }

    get cameraUp() {
        return ThreeHelper.toXYZ(this._camera.up);
    }

    get camera(): OrthographicCamera {
        return this._camera;
    }

    constructor(readonly view: ThreeView) {
        super();
        this._camera = this.createCamera(CAMERA_NEAR, CAMERA_FAR);
    }

    private createCamera(near: number, far: number) {
        const camera = new OrthographicCamera(
            -this._width / 2,
            this._width / 2,
            this._height / 2,
            -this._height / 2,
            near,
            far,
        );
        this.setCameraLayer(camera, this.view.mode);
        return camera;
    }

    setCameraLayer(camera: Camera, mode: ViewMode) {
        // Fills are drawn in every mode. Wireframe switches off *shading*, not the
        // drawing's own filled regions - a hatch is as much a part of a 2D drawing as
        // the lines bounding it, and hiding it here is what made HATCH look like it did
        // nothing at all. Which faces count as fills is decided per node by
        // GeometryNode.filled; the rest stay on Solid and stay hidden.
        camera.layers.enable(Constants.Layers.Fill);
        if (mode === "wireframe") {
            camera.layers.enable(Constants.Layers.Wireframe);
            camera.layers.disable(Constants.Layers.Solid);
        } else if (mode === "solid") {
            camera.layers.enable(Constants.Layers.Solid);
            camera.layers.disable(Constants.Layers.Wireframe);
        } else {
            camera.layers.enableAll();
        }
    }

    pan(dx: number, dy: number): void {
        const ratio = PAN_SPEED_FACTOR * this._target.distanceTo(this._position);
        const direction = this._target.clone().sub(this._position).normalize();
        const hor = direction.clone().cross(this.camera.up).normalize();
        const ver = hor.clone().cross(direction).normalize();
        const vector = hor.multiplyScalar(-dx).add(ver.multiplyScalar(dy)).multiplyScalar(ratio);
        this._target.add(vector);
        this._position.add(vector);

        this.updateCameraPosionTarget();
    }

    updateCameraPosionTarget() {
        this._camera.position.copy(this._position);
        this._camera.lookAt(this._target);
        this._camera.updateProjectionMatrix();
    }

    setSize(width: number, height: number): void {
        this._width = width;
        this._height = height;
        this.updateOrthographicCamera(this.camera);
        this.camera.updateProjectionMatrix();
    }

    private updateOrthographicCamera(camera: OrthographicCamera) {
        const aspect = this._width / this._height;
        const length = this._position.distanceTo(this._target);
        const frustumHalfHeight = length * Math.tan((FRUSTUM_FOV * DEG_TO_RAD) / 2);
        camera.left = -frustumHalfHeight * aspect;
        camera.right = frustumHalfHeight * aspect;
        camera.top = frustumHalfHeight;
        camera.bottom = -frustumHalfHeight;
    }

    fitContent(): void {
        const context = this.view.document.visual.context as ThreeVisualContext;
        const sphere = this.getBoundingSphere(context);
        let fieldOfView = FRUSTUM_FOV / 2.0;
        if (this._width < this._height) {
            fieldOfView = (fieldOfView * this._width) / this._height;
        }

        const distance = Math.abs(sphere.radius / Math.sin(fieldOfView * DEG_TO_RAD));
        const direction = this._target.clone().sub(this._position).normalize();
        this._target.copy(sphere.center);
        this._position.copy(this._target.clone().sub(direction.clone().multiplyScalar(distance)));

        this.updateOrthographicCamera(this._camera);
        this.updateCameraNearFar();
        this.updateCameraPosionTarget();
    }

    private getBoundingSphere(context: ThreeVisualContext) {
        const shapes = this.view.document.selection.getSelectedVisualNodes();

        const box = new Box3();
        if (shapes.length === 0) {
            box.setFromObject(context.visualShapes);
        } else {
            for (const shape of shapes) {
                const threeGeometry = context.getVisual(shape) as ThreeGeometry;
                const boundingBox = new Box3().setFromObject(threeGeometry);
                if (boundingBox) {
                    box.union(boundingBox);
                }
            }
        }

        const sphere = new Sphere();
        box.getBoundingSphere(sphere);
        if (sphere.radius < 0) {
            sphere.radius = SHAPE_EMPTY_SIZE;
        }
        return sphere;
    }

    zoom(x: number, y: number, delta: number): void {
        const vector = this._target.clone().sub(this._position);

        const zoomFactor = this.caclueZoomFactor(x, y, vector);
        const scale = delta > 0 ? zoomFactor : -zoomFactor;
        const mouse = this.mouseToWorld(x, y);
        const targetMoveVector = this._target.clone().sub(mouse).multiplyScalar(scale);
        this._target.add(targetMoveVector);
        this._position.copy(this._target.clone().sub(vector.clone().multiplyScalar(1 + scale)));
        if (vector.length() < MIN_CARME_TO_TARGET) {
            this._target = this._position
                .clone()
                .add(vector.clone().normalize().multiplyScalar(MIN_CARME_TO_TARGET));
        }

        this.updateOrthographicCamera(this._camera);
        this.updateCameraNearFar();
        this.updateCameraPosionTarget();
    }

    private caclueZoomFactor(x: number, y: number, direction: Vector3) {
        const raycaster = new Raycaster();
        raycaster.setFromCamera(this.view.screenToCameraRect(x, y), this.camera);
        const intersect = raycaster.intersectObjects(this.view.content.visualShapes.children).at(0)?.point;
        let zoomFactor = ZOOM_SPEED_FACTOR;
        if (intersect) {
            zoomFactor = (ZOOM_SPEED_FACTOR * this._position.distanceTo(intersect)) / direction.length();
        }
        return zoomFactor;
    }

    private updateCameraNearFar() {
        const distance = this._position.distanceTo(this._target);

        const nearPlane = Math.max(0.01, Math.min(distance / 1000, distance / 10));
        const farPlane = Math.max(1000, distance * 100);

        this.camera.near = nearPlane;
        this.camera.far = farPlane;
    }

    lookAt(eye: XYZLike, target: XYZLike, up: XYZLike): void {
        this._position.set(eye.x, eye.y, eye.z);
        this._target.set(target.x, target.y, target.z);
        this.camera.up.set(up.x, up.y, up.z);
        this.updateCameraPosionTarget();
    }

    private mouseToWorld(mx: number, my: number) {
        const x = (2.0 * mx) / this._width - 1;
        const y = (-2.0 * my) / this._height + 1;
        const dist = this._position.distanceTo(this._target);
        const z = (this._camera.far + this._camera.near - 2 * dist) / (this._camera.near - this._camera.far);

        return new Vector3(x, y, z).unproject(this._camera);
    }
}
