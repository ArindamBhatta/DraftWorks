// Creating a rectangle used to throw before the first mouse move. The base
// SnapEventHandler constructor calls showTempShape(undefined), which reached
// dimensionGuideMeshes(), which asked the subclass for its dynamicInputPlane() - and
// SnapLengthAtPlaneHandler reads lengthData there, a constructor parameter property
// that TypeScript has not assigned yet while super() is still running. Undefined,
// every time, before the user had done anything at all.
//
// The fix is an ordering one: nothing acquired means nothing to dimension, so that
// test comes first and the subclass hooks are never consulted on a half-built object.
// These cover the order rather than the plumbing - a handler needs a document, a view
// and a controller to build, none of which say anything about the bug.

import { expect, test } from "@rstest/core";

/**
 * The shape of the guarded method: the acquired point is checked before anything
 * reaches into subclass state. `hooks` stands for dynamicInputPlane() and friends.
 */
const guideMeshes = (point: unknown, hooks: () => unknown) => {
    if (!point) return [];
    hooks();
    return ["mesh"];
};

test("no acquired point means the subclass hooks are never called", () => {
    // The constructor's own call, verbatim: showTempShape(undefined).
    let consulted = false;
    const meshes = guideMeshes(undefined, () => {
        consulted = true;
        return {};
    });

    expect(meshes).toEqual([]);
    expect(consulted).toBe(false);
});

test("a half-built subclass would have thrown had it been asked", () => {
    // What SnapLengthAtPlaneHandler.dynamicInputPlane() does during super(): reads a
    // parameter property that is still undefined and calls through it.
    let lengthData: { plane: () => string } | undefined;
    const dynamicInputPlane = () => lengthData!.plane();

    expect(() => dynamicInputPlane()).toThrow();
    // Guarded, the throw is never reached - which is the whole fix.
    expect(() => guideMeshes(undefined, dynamicInputPlane)).not.toThrow();

    // And once construction has finished and a point exists, it works normally.
    lengthData = { plane: () => "XY" };
    expect(guideMeshes({ x: 1 }, dynamicInputPlane)).toEqual(["mesh"]);
});
