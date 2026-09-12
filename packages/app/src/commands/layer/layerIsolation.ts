import type { IDocument } from "@draftworks/core";

/** What a layer looked like before LAYISO hid it. */
export interface IsolatedLayerState {
    visible: boolean;
    frozen: boolean;
}

/**
 * The restore point LAYUNISO puts back, held per document.
 *
 * Deliberately *not* on the Layer model. AutoCAD's own LAYUNISO only restores within a
 * session - close the drawing and the isolation is simply gone, there is no "previously
 * isolated" state saved into the DWG - so a serialized field would be recording something
 * the format does not carry. Keeping it here also means isolating is not an edit to the
 * drawing: it does not dirty the document or land on the undo stack, which matches how
 * AutoCAD treats it as a view convenience rather than a change to the model.
 *
 * A WeakMap so a closed document takes its snapshot with it.
 */
const snapshots = new WeakMap<IDocument, Map<string, IsolatedLayerState>>();

/**
 * Records every layer's current on/frozen state, unless a recording already exists.
 *
 * The "unless" is the AutoCAD behaviour: isolating twice in a row still restores to how
 * things looked before the *first* isolate, not to the half-hidden state the second one
 * started from.
 */
export function captureIsolation(document: IDocument): void {
    if (snapshots.has(document)) return;

    const state = new Map<string, IsolatedLayerState>();
    document.modelManager.layers.forEach((layer) => {
        state.set(layer.id, { visible: layer.visible, frozen: layer.frozen });
    });
    snapshots.set(document, state);
}

export function isolationSnapshot(document: IDocument): Map<string, IsolatedLayerState> | undefined {
    return snapshots.get(document);
}

export function clearIsolation(document: IDocument): void {
    snapshots.delete(document);
}
