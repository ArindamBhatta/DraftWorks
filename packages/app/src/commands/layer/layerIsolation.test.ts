// LAYISO's restore point. The rule worth guarding is that isolating twice does not move
// it: the second isolate starts from an already half-hidden drawing, so recording that
// as the thing to restore would strand every layer the first isolate turned off.

import type { IDocument } from "@draftworks/core";
import { expect, test } from "@rstest/core";
import { captureIsolation, clearIsolation, isolationSnapshot } from "./layerIsolation";

interface FakeLayer {
    id: string;
    visible: boolean;
    frozen: boolean;
}

/** Only `modelManager.layers` is read, and the document itself is a WeakMap key. */
const documentOf = (...layers: FakeLayer[]) => ({ modelManager: { layers } }) as unknown as IDocument;

const layer = (id: string, visible = true, frozen = false): FakeLayer => ({ id, visible, frozen });

test("a capture records every layer's on and frozen state", () => {
    const document = documentOf(layer("a"), layer("b", false), layer("c", true, true));

    captureIsolation(document);

    expect(isolationSnapshot(document)?.get("a")).toEqual({ visible: true, frozen: false });
    expect(isolationSnapshot(document)?.get("b")).toEqual({ visible: false, frozen: false });
    expect(isolationSnapshot(document)?.get("c")).toEqual({ visible: true, frozen: true });
});

test("isolating twice keeps the first restore point", () => {
    const layers = [layer("a"), layer("b")];
    const document = documentOf(...layers);

    captureIsolation(document);
    // What LAYISO does next: everything outside the kept set goes off.
    layers[1].visible = false;
    captureIsolation(document);

    // The second capture must not have recorded "b" as already off, or LAYUNISO would
    // leave it hidden forever.
    expect(isolationSnapshot(document)?.get("b")).toEqual({ visible: true, frozen: false });
});

test("clearing drops the restore point so the next isolate takes a fresh one", () => {
    const layers = [layer("a")];
    const document = documentOf(...layers);

    captureIsolation(document);
    clearIsolation(document);
    expect(isolationSnapshot(document)).toBeUndefined();

    layers[0].visible = false;
    captureIsolation(document);
    expect(isolationSnapshot(document)?.get("a")).toEqual({ visible: false, frozen: false });
});

test("each document keeps its own restore point", () => {
    const first = documentOf(layer("a", false));
    const second = documentOf(layer("a", true));

    captureIsolation(first);
    captureIsolation(second);

    expect(isolationSnapshot(first)?.get("a")?.visible).toBe(false);
    expect(isolationSnapshot(second)?.get("a")?.visible).toBe(true);
});

test("a document that was never isolated has nothing to restore", () => {
    // What sends LAYUNISO down its "No layers are isolated" branch.
    expect(isolationSnapshot(documentOf(layer("a")))).toBeUndefined();
});
