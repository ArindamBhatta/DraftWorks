// LWT (AutoCAD's LWDISPLAY) works by changing `linewidth` on the cached materials in
// place, while the cache key keeps the weight the layer actually assigned. That split is
// what these cover: turning the display off must not lose the assigned weight, and
// turning it back on must restore exactly that weight rather than a default.

import { Config } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { layerEdgeMaterial } from "./materials";

/** Runs `body` with LWT forced to a known state, then puts it back. */
function withLineWeightDisplay(shown: boolean, body: () => void) {
    const previous = Config.instance.showLineWeight;
    try {
        Config.instance.showLineWeight = shown;
        body();
    } finally {
        Config.instance.showLineWeight = previous;
    }
}

test("with LWT on, an edge is drawn at the weight its layer assigned", () => {
    withLineWeightDisplay(true, () => {
        expect(layerEdgeMaterial(0xff0000, "solid", 3).linewidth).toBe(3);
    });
});

test("with LWT off, everything is drawn thin", () => {
    withLineWeightDisplay(false, () => {
        expect(layerEdgeMaterial(0x00ff00, "solid", 5).linewidth).toBe(1);
    });
});

test("turning LWT off and on again restores the assigned weight, not a default", () => {
    // The material is shared and cached, so the assigned weight lives only in the cache
    // key - if the toggle read it back wrongly, a 4px layer would come back at 1px and
    // the drawing would be quietly flattened for the rest of the session.
    const material = layerEdgeMaterial(0x0000ff, "solid", 4);
    expect(material.linewidth).toBe(4);

    withLineWeightDisplay(false, () => {
        expect(material.linewidth).toBe(1);
    });

    // Restored by the finally above, which flips the config back.
    expect(material.linewidth).toBe(4);
});

test("a weight-1 edge is unaffected either way", () => {
    const material = layerEdgeMaterial(0x123456, "solid", 1);
    withLineWeightDisplay(false, () => {
        expect(material.linewidth).toBe(1);
    });
    expect(material.linewidth).toBe(1);
});

test("the toggle reaches materials created while it was off", () => {
    withLineWeightDisplay(false, () => {
        const material = layerEdgeMaterial(0xabcdef, "dash", 6);
        expect(material.linewidth).toBe(1);

        Config.instance.showLineWeight = true;
        expect(material.linewidth).toBe(6);
    });
});
