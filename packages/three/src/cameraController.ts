// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ICameraController, Observable, type ViewMode, type XYZLike } from "@chili3d/core";
import { Box3, Camera, MathUtils, type Object3D, OrthographicCamera, Sphere, Vector3 } from "three";
import { Constants } from "./constants";
import type { ThreeGeometry } from "./threeGeometry";
import { ThreeHelper } from "./threeHelper";
import type { ThreeView } from "./threeView";
import type { ThreeVisualContext } from "./threeVisualContext";

// Multiplicative zoom step. In and out are exact reciprocals, so a zoom in followed by
// a zoom out lands back on the magnification you started from.
const ZOOM_STEP = 1.1;
// Guard rails on the frustum, not on the camera's distance: an orthographic camera
// magnifies by frustum size alone, so these are the actual zoom limits. They only exist
// to keep the projection from collapsing or overflowing - both are far outside the range
// any real drawing needs.
const MIN_FRUSTUM_HALF_HEIGHT = 1e-3;
const MAX_FRUSTUM_HALF_HEIGHT = 1e9;
// Half the height of the view before anything has been fitted, in drawing units.
const DEFAULT_FRUSTUM_HALF_HEIGHT = 500;
// Slack left around the content by fitContent, so a fitted drawing doesn't touch the
// viewport edges.
const FIT_MARGIN = 1.1;
const SHAPE_EMPTY_SIZE = 800;

/**
 * Screen up, and the camera's standoff from the drawing plane. The drawing plane is
 * Plane.Top (XY), so the camera looks along -Z with world Y up - that is what makes
 * world X read as screen right and world Y as screen up, so a typed `2000,500` comes
 * out 2000 wide and 500 tall.
 */
const CAMERA_UP = new Vector3(0, 1, 0);
const CAMERA_OFFSET = new Vector3(0, 0, 1000);
const DEFAULT_STANDOFF = CAMERA_OFFSET.length();

Camera.DEFAULT_UP = CAMERA_UP.clone();

/**
 * Orthographic-only camera. The old free-orbit controls (perspective camera,
 * startRotate/rotate, rotate-center tracking) are gone: a 2D drafting view only ever
 * pans, zooms and fits, so the projection stays a fixed plan view.
 *
 * Magnification lives in `_frustumHalfHeight`, *not* in the camera's distance from the
 * drawing. An orthographic projection is scale-invariant along its view axis, so the
 * standoff only decides what stays inside the depth range; driving the zoom with it (as
 * this used to, via a fake field of view) meant zooming in walked the camera towards the
 * drawing plane until it clipped through and the drawing vanished.
 */
export class CameraController extends Observable implements ICameraController {
    private _width: number = 100;
    private _height: number = 100;
    private _target: Vector3 = new Vector3();
    private _position: Vector3 = CAMERA_OFFSET.clone();
    private _camera: OrthographicCamera;
    private _frustumHalfHeight: number = DEFAULT_FRUSTUM_HALF_HEIGHT;
    /** Distance from the camera to the target plane; kept constant by zoom and pan. */
    private _standoff: number = DEFAULT_STANDOFF;

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
        this._camera = this.createCamera();
        // Place the camera up front rather than waiting for the first fit/pan/zoom, so
        // the very first frame already looks down the drawing plane's normal.
        this.updateOrthographicCamera(this._camera);
        this.updateCameraNearFar();
        this.updateCameraPosionTarget();
    }

    private createCamera() {
        const camera = new OrthographicCamera();
        // Set on the instance rather than relying on Camera.DEFAULT_UP having been
        // assigned before this module's first camera is built. It also has to stay
        // non-parallel to the view direction: pan() takes direction x up, so a parallel
        // pair collapses to the zero vector and normalize() hands back NaN.
        camera.up.copy(CAMERA_UP);
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
        // One screen pixel is exactly this many drawing units, so the drawing keeps up
        // with the cursor instead of sliding out from under it.
        const unitsPerPixel = (2 * this._frustumHalfHeight) / this._height;
        const { right, up } = this.screenAxes();
        const vector = right.multiplyScalar(-dx).add(up.multiplyScalar(dy)).multiplyScalar(unitsPerPixel);
        this._target.add(vector);
        this._position.add(vector);

        this.updateCameraPosionTarget();
    }

    updateCameraPosionTarget() {
        this._camera.position.copy(this._position);
        this._camera.lookAt(this._target);
        // Keep the world matrix in step with the pose right away: screenToWorld and the
        // renderer both read it, and a pan followed by a zoom inside one frame would
        // otherwise anchor the zoom on the pre-pan camera.
        this._camera.updateMatrixWorld(true);
        this._camera.updateProjectionMatrix();
    }

    setSize(width: number, height: number): void {
        this._width = width;
        this._height = height;
        this.updateOrthographicCamera(this.camera);
        this.updateCameraNearFar();
        this.camera.updateProjectionMatrix();
    }

    private updateOrthographicCamera(camera: OrthographicCamera) {
        const aspect = this._width / this._height;
        const halfWidth = this._frustumHalfHeight * aspect;
        camera.left = -halfWidth;
        camera.right = halfWidth;
        camera.top = this._frustumHalfHeight;
        camera.bottom = -this._frustumHalfHeight;
    }

    fitContent(): void {
        const context = this.view.document.visual.context as ThreeVisualContext;
        const content = this.sphereOf(context.visualShapes);
        const focus = this.focusSphere(context, content);
        const aspect = this._width / this._height;

        // Sized off the height, then widened when the viewport is taller than it is
        // wide, so the content fits across the narrow axis either way.
        this._frustumHalfHeight = this.clampFrustum((focus.radius * FIT_MARGIN) / Math.min(1, aspect));
        // The whole drawing - not just what is being fitted - has to stay in front of
        // the camera, since the standoff is then held fixed through every zoom and pan.
        this._standoff = Math.max(DEFAULT_STANDOFF, content.radius * 2);
        const { forward } = this.screenAxes();
        this._target.copy(focus.center);
        this._position.copy(this._target.clone().sub(forward.multiplyScalar(this._standoff)));

        this.updateOrthographicCamera(this._camera);
        this.updateCameraNearFar();
        this.updateCameraPosionTarget();
    }

    /** What a fit should frame: the current selection, or the whole drawing. */
    private focusSphere(context: ThreeVisualContext, content: Sphere) {
        const shapes = this.view.document.selection.getSelectedVisualNodes();
        if (shapes.length === 0) {
            return content;
        }

        const box = new Box3();
        for (const shape of shapes) {
            const threeGeometry = context.getVisual(shape) as ThreeGeometry;
            box.union(new Box3().setFromObject(threeGeometry));
        }
        return this.sphereOfBox(box);
    }

    private sphereOf(object: Object3D) {
        return this.sphereOfBox(new Box3().setFromObject(object));
    }

    private sphereOfBox(box: Box3) {
        const sphere = box.getBoundingSphere(new Sphere());
        if (sphere.radius < 0) {
            // An empty box hands back radius -1; frame a default-sized patch of the
            // drawing plane instead of collapsing the view.
            sphere.radius = SHAPE_EMPTY_SIZE;
        }
        return sphere;
    }

    zoom(x: number, y: number, delta: number): void {
        // The world point under the cursor, taken before the frustum changes - it is the
        // one point the zoom has to leave standing still.
        const anchor = this.screenToTargetPlane(x, y);
        const { forward } = this.screenAxes();

        const previous = this._frustumHalfHeight;
        this._frustumHalfHeight = this.clampFrustum(delta > 0 ? previous * ZOOM_STEP : previous / ZOOM_STEP);
        // Close the target on the anchor by exactly the fraction the frustum shrank.
        // Reading the ratio back off the clamped value keeps the two honest: at a zoom
        // limit the scale is 1, so the view neither magnifies nor slides.
        const scale = this._frustumHalfHeight / previous;
        this._target.copy(anchor.add(this._target.clone().sub(anchor).multiplyScalar(scale)));
        // The standoff never changes, so no amount of zooming in can sink the camera
        // through the drawing plane.
        this._position.copy(this._target.clone().sub(forward.multiplyScalar(this._standoff)));

        this.updateOrthographicCamera(this._camera);
        this.updateCameraNearFar();
        this.updateCameraPosionTarget();
    }

    private clampFrustum(halfHeight: number) {
        return MathUtils.clamp(halfHeight, MIN_FRUSTUM_HALF_HEIGHT, MAX_FRUSTUM_HALF_HEIGHT);
    }

    /** Camera-space axes in world terms: `right` and `up` span the screen. */
    private screenAxes() {
        const forward = this._target.clone().sub(this._position).normalize();
        const right = forward.clone().cross(this._camera.up).normalize();
        const up = right.clone().cross(forward).normalize();
        return { forward, right, up };
    }

    private updateCameraNearFar() {
        // Depth range is a function of the standoff and the zoom only - never of the
        // magnification's history - so it stays put while zooming. The extra depth keeps
        // whatever sits behind the drawing (the grid parks itself a slice of the view
        // height back) inside the far plane at any zoom level.
        const depth = Math.max(this._standoff, this._frustumHalfHeight * 4);
        this.camera.near = Math.max(0.01, this._standoff / 1000);
        this.camera.far = this._standoff + depth;
    }

    lookAt(eye: XYZLike, target: XYZLike, up: XYZLike): void {
        this._position.set(eye.x, eye.y, eye.z);
        this._target.set(target.x, target.y, target.z);
        this.camera.up.set(up.x, up.y, up.z);
        this._standoff = Math.max(this._position.distanceTo(this._target), DEFAULT_STANDOFF);
        this.updateCameraNearFar();
        this.updateCameraPosionTarget();
    }

    /**
     * Screen point to the world point under it, on the plane through the target. In an
     * orthographic view that plane is the only one that matters: every other depth
     * projects to the same place on screen.
     */
    private screenToTargetPlane(mx: number, my: number) {
        const { right, up } = this.screenAxes();
        const ndcX = (2 * mx) / this._width - 1;
        const ndcY = 1 - (2 * my) / this._height;
        const aspect = this._width / this._height;
        return this._target
            .clone()
            .add(right.multiplyScalar(ndcX * this._frustumHalfHeight * aspect))
            .add(up.multiplyScalar(ndcY * this._frustumHalfHeight));
    }
}
