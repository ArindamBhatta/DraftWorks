import { describe, expect, test } from "@rstest/core";
import { BoxGeometry, Mesh, Object3D, Vector3 } from "three";
import { CameraController } from "./cameraController";
import type { ThreeView } from "./threeView";

const VIEW_WIDTH = 1200;
const VIEW_HEIGHT = 800;

/** A drawing `size` units across, flat on the XY plane like everything this app draws. */
const drawing = (size: number) => {
    const content = new Object3D();
    content.add(new Mesh(new BoxGeometry(size, size, 0)));
    content.updateMatrixWorld(true);
    return content;
};

const controllerOf = (content: Object3D) => {
    const view = {
        mode: "wireframe",
        document: {
            visual: { context: { visualShapes: content, getVisual: () => undefined } },
            selection: { getSelectedVisualNodes: () => [] },
        },
    } as unknown as ThreeView;
    const controller = new CameraController(view);
    controller.setSize(VIEW_WIDTH, VIEW_HEIGHT);
    controller.fitContent();
    return controller;
};

/** Where a world point lands on screen, in pixels. */
const toScreen = (controller: CameraController, point: Vector3) => {
    const ndc = point.clone().project(controller.camera);
    return { x: ((ndc.x + 1) / 2) * VIEW_WIDTH, y: ((1 - ndc.y) / 2) * VIEW_HEIGHT };
};

const magnification = (controller: CameraController) => controller.camera.top - controller.camera.bottom;

describe("CameraController zoom", () => {
    test("zooming in magnifies, whatever the drawing's scale", () => {
        for (const size of [20, 2000, 200_000]) {
            const controller = controllerOf(drawing(size));
            const fitted = magnification(controller);

            controller.zoom(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, -5);
            expect(magnification(controller)).toBeLessThan(fitted);

            controller.zoom(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, 5);
            expect(magnification(controller)).toBeCloseTo(fitted, 6);
        }
    });

    /**
     * The regression this suite exists for. Zoom used to magnify by walking the camera
     * towards its target, floored at a fixed distance of 50 units - so on any drawing
     * fitted closer than that (anything under ~20 units across, which is what fitting a
     * single selected object usually gives you) the first zoom in jumped the camera
     * *back* to the floor and every later one oscillated against it, dragging the target
     * through the drawing plane until the drawing fell behind the camera entirely.
     */
    test("repeated zoom in keeps magnifying and keeps the drawing in front of the camera", () => {
        const controller = controllerOf(drawing(20));
        let previous = magnification(controller);

        for (let i = 0; i < 25; i++) {
            controller.zoom(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, -5);
            const current = magnification(controller);
            expect(current).toBeLessThan(previous);
            previous = current;

            // The drawing sits on z = 0; the camera looks down -Z from above it and has
            // to stay there, between its near and far planes.
            const depth = controller.camera.position.z;
            expect(depth).toBeGreaterThan(controller.camera.near);
            expect(depth).toBeLessThan(controller.camera.far);
        }
    });

    test("fitting a drawing centres it and leaves it inside the viewport", () => {
        const size = 500;
        const controller = controllerOf(drawing(size));

        expect(toScreen(controller, new Vector3())).toEqual({ x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2 });
        const corner = toScreen(controller, new Vector3(size / 2, size / 2, 0));
        expect(corner.x).toBeGreaterThan(0);
        expect(corner.x).toBeLessThan(VIEW_WIDTH);
        expect(corner.y).toBeGreaterThan(0);
        expect(corner.y).toBeLessThan(VIEW_HEIGHT);
    });

    test("zoom holds the point under the cursor still", () => {
        const controller = controllerOf(drawing(1000));
        const point = new Vector3(180, -240, 0);
        const before = toScreen(controller, point);

        for (const delta of [-5, -5, 5]) {
            controller.zoom(before.x, before.y, delta);
            const after = toScreen(controller, point);
            expect(after.x).toBeCloseTo(before.x, 6);
            expect(after.y).toBeCloseTo(before.y, 6);
        }
    });

    test("pan moves the drawing with the cursor, pixel for pixel", () => {
        const controller = controllerOf(drawing(1000));
        const point = new Vector3(120, 340, 0);
        const before = toScreen(controller, point);

        controller.pan(60, -25);

        const after = toScreen(controller, point);
        expect(after.x).toBeCloseTo(before.x + 60, 6);
        expect(after.y).toBeCloseTo(before.y - 25, 6);
    });
});
