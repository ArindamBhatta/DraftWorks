// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, type IDisposable, type Plane, VisualConfig, type VisualItemConfig } from "@chili3d/core";
import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, type Scene } from "three";
import { Constants } from "./constants";
import type { ThreeView } from "./threeView";

/** Minimum on-screen spacing, in CSS pixels, before the grid steps up a decade. */
const MIN_PIXELS_PER_LINE = 10;
/** Every Nth minor line is drawn as a major line, AutoCAD's default grid ratio. */
const MAJOR_EVERY = 5;
/**
 * Margin on the grid's half-extent, so a small pan does not reveal an edge before the
 * next rebuild. Applied to the viewport's circumradius (see update), which already
 * over-covers the visible rectangle, so it does not need to be generous.
 */
const OVERDRAW = 1.15;
/** Guard against pathological zoom levels producing millions of segments. */
const MAX_LINES_PER_AXIS = 600;
/**
 * How far behind the drawing plane the grid sits, as a fraction of the visible height.
 * The drawing and the grid are otherwise exactly coplanar, which would z-fight. Under
 * an orthographic camera, sliding along the view axis moves nothing on screen, so this
 * separation is free - there is no parallax to give it away.
 */
const DEPTH_NUDGE = 0.05;
/** Opacity of the minor and major grid lines against the canvas. */
const MINOR_OPACITY = 0.18;
const MAJOR_OPACITY = 0.42;

/** The 1 / 2 / 5 / 10 ... progression AutoCAD's grid steps through as you zoom out. */
function niceSpacing(minimum: number): number {
    const decade = 10 ** Math.floor(Math.log10(minimum));
    for (const step of [1, 2, 5]) {
        if (decade * step >= minimum) return decade * step;
    }
    return decade * 10;
}

/**
 * AutoCAD's GRID: a reference grid drawn in the drawing plane, in world space, so it
 * pans and zooms with the drawing rather than sitting on the glass. The spacing is
 * adaptive - it re-picks a 1/2/5 decade step from the current zoom so lines never
 * crowd - which is why there is no grid-spacing setting to go with Config.enableGrid.
 *
 * The geometry is rebuilt only when the visible extent actually moves to a different
 * grid cell or spacing, so a smooth pan reuses the same buffers.
 */
export class ThreeGrid implements IDisposable {
    private readonly _minor: LineSegments;
    private readonly _major: LineSegments;
    private _signature = "";

    constructor(
        private readonly view: ThreeView,
        private readonly scene: Scene,
    ) {
        this._minor = this.createLines(MINOR_OPACITY);
        this._major = this.createLines(MAJOR_OPACITY);
        this.scene.add(this._minor, this._major);
        Config.instance.onPropertyChanged(this.handleConfigChanged);
        VisualConfig.onPropertyChanged(this.handleVisualConfigChanged);
    }

    private createLines(opacity: number) {
        const lines = new LineSegments(
            new BufferGeometry(),
            new LineBasicMaterial({
                // Same colour the drawing's edges use, so the grid follows the light /
                // dark theme instead of vanishing into one of the two backgrounds.
                color: VisualConfig.defaultEdgeColor,
                transparent: true,
                opacity,
                depthWrite: false,
            }),
        );
        // Behind everything, and never pickable - the raycaster only walks
        // context.visualShapes, so it never sees these.
        lines.renderOrder = -1;
        lines.layers.set(Constants.Layers.Default);
        lines.frustumCulled = false;
        return lines;
    }

    private readonly handleConfigChanged = (property: keyof Config) => {
        if (property === "enableGrid") {
            this.view.update();
        }
    };

    private readonly handleVisualConfigChanged = (property: keyof VisualItemConfig) => {
        if (property !== "defaultEdgeColor") return;
        for (const lines of [this._minor, this._major]) {
            (lines.material as LineBasicMaterial).color.set(VisualConfig.defaultEdgeColor);
        }
        this.view.update();
    };

    /** Called from the view's render tick, i.e. whenever the camera may have moved. */
    update() {
        const visible = Config.instance.enableGrid;
        this._minor.visible = visible;
        this._major.visible = visible;
        if (!visible) return;

        const camera = this.view.camera;
        const worldHeight = camera.top - camera.bottom;
        const worldWidth = camera.right - camera.left;
        if (worldHeight <= 0 || worldWidth <= 0 || this.view.height <= 0) return;

        const pixelsPerUnit = this.view.height / worldHeight;
        const minor = niceSpacing(MIN_PIXELS_PER_LINE / pixelsPerUnit);
        const major = minor * MAJOR_EVERY;

        // Sit behind the drawing rather than in it - see DEPTH_NUDGE. direction() points
        // from the camera into the scene, so this is straight away from the viewer.
        const behind = this.view.direction().multiply(worldHeight * DEPTH_NUDGE);
        this._minor.position.set(behind.x, behind.y, behind.z);
        this._major.position.copy(this._minor.position);

        // Centre the grid on the camera target, snapped to the major step so the
        // pattern stays anchored to the drawing rather than sliding under the cursor.
        const plane = this.view.workplane;
        const target = this.view.cameraController.cameraTarget;
        const offset = target.sub(plane.origin);
        const centerU = Math.round(offset.dot(plane.xvec) / major) * major;
        const centerV = Math.round(offset.dot(plane.yvec) / major) * major;

        // One half-extent for both axes, taken from the viewport's circumradius. The
        // plane's u/v axes are not required to line up with screen x/y - under the
        // default ZX workplane, u is world Z (screen vertical) and v is world X - so
        // sizing u by width and v by height would leave a bare strip on wide viewports.
        const half = (Math.hypot(worldWidth, worldHeight) * OVERDRAW) / 2;

        const signature = `${minor}|${centerU}|${centerV}|${half.toFixed(3)}`;
        if (signature === this._signature) return;
        this._signature = signature;

        this.rebuild(plane, minor, major, centerU, centerV, half);
    }

    private rebuild(
        plane: Plane,
        minor: number,
        major: number,
        centerU: number,
        centerV: number,
        half: number,
    ) {
        const startU = Math.ceil((centerU - half) / minor) * minor;
        const startV = Math.ceil((centerV - half) / minor) * minor;
        const count = Math.min(MAX_LINES_PER_AXIS, Math.floor((2 * half) / minor) + 1);

        const minU = centerU - half;
        const maxU = centerU + half;
        const minV = centerV - half;
        const maxV = centerV + half;

        const minorPoints: number[] = [];
        const majorPoints: number[] = [];
        const isMajor = (value: number) => Math.abs(value % major) < minor / 2;

        // A line at constant u spans v, and vice versa.
        for (let i = 0; i < count; i++) {
            const u = startU + i * minor;
            const into = isMajor(u) ? majorPoints : minorPoints;
            this.pushSegment(into, plane, u, minV, u, maxV);
        }
        for (let i = 0; i < count; i++) {
            const v = startV + i * minor;
            const into = isMajor(v) ? majorPoints : minorPoints;
            this.pushSegment(into, plane, minU, v, maxU, v);
        }

        this.setPositions(this._minor, minorPoints);
        this.setPositions(this._major, majorPoints);
    }

    private pushSegment(target: number[], plane: Plane, u1: number, v1: number, u2: number, v2: number) {
        const a = plane.origin.add(plane.xvec.multiply(u1)).add(plane.yvec.multiply(v1));
        const b = plane.origin.add(plane.xvec.multiply(u2)).add(plane.yvec.multiply(v2));
        target.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }

    private setPositions(lines: LineSegments, points: number[]) {
        lines.geometry.dispose();
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(new Float32Array(points), 3));
        lines.geometry = geometry;
    }

    dispose() {
        Config.instance.removePropertyChanged(this.handleConfigChanged);
        VisualConfig.removePropertyChanged(this.handleVisualConfigChanged);
        this.scene.remove(this._minor, this._major);
        this._minor.geometry.dispose();
        this._major.geometry.dispose();
        (this._minor.material as LineBasicMaterial).dispose();
        (this._major.material as LineBasicMaterial).dispose();
    }
}
