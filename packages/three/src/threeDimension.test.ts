import { describe, expect, test } from "@rstest/core";
import { PerspectiveCamera, Raycaster, Vector2 } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { lineGeometry } from "./threeDimension";

const raycastAt = (object: LineSegments2) => {
    const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    object.updateMatrixWorld(true);

    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(0, 0), camera);
    raycaster.camera = camera;
    return raycaster.intersectObjects([object], false);
};

const material = () => {
    const value = new LineMaterial({ linewidth: 1 });
    value.resolution = new Vector2(800, 600);
    return value;
};

describe("lineGeometry", () => {
    /**
     * A bare LineSegmentsGeometry has no instanceStart, which is the attribute three's
     * `raycastScreenSpace` dereferences without checking. It survives a raycast today
     * only because its bounding box is empty, so the box test rejects it first - a guard
     * that holds by luck rather than by design, and stops holding the moment anything
     * gives the geometry a real bounding box.
     */
    test("a bare LineSegmentsGeometry lacks the attribute raycasting needs", () => {
        const bare = new LineSegments2(new LineSegmentsGeometry(), material());
        expect(bare.geometry.attributes["instanceStart"]).toBeUndefined();
        expect(bare.geometry.boundingBox).toBeNull();
    });

    test("an empty geometry still has the attributes raycasting needs", () => {
        const empty = lineGeometry([]);
        expect(empty.attributes["instanceStart"]).toBeDefined();
        expect(empty.attributes["instanceStart"].count).toBe(0);
    });

    test("raycasting an empty geometry finds nothing instead of throwing", () => {
        const object = new LineSegments2(lineGeometry([]), material());
        expect(raycastAt(object)).toEqual([]);
    });

    test("real positions still produce segments", () => {
        const geometry = lineGeometry([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0]);
        expect(geometry.attributes["instanceStart"].count).toBe(2);
    });

    test("accepts a Float32Array without copying it into a plain array", () => {
        const geometry = lineGeometry(new Float32Array([0, 0, 0, 1, 0, 0]));
        expect(geometry.attributes["instanceStart"].count).toBe(1);
    });
});
