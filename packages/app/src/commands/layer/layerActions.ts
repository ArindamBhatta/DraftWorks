import {
    AsyncController,
    CancelableCommand,
    command,
    type I18nKeys,
    type IApplication,
    type ICommand,
    type IDocument,
    type Layer,
    PubSub,
    Transaction,
    type VisualNode,
} from "@chili3d/core";
import { captureIsolation, clearIsolation, isolationSnapshot } from "./layerIsolation";

/**
 * AutoCAD's Layers panel quick actions - the two rows of icons under the layer combo.
 *
 * They split into two shapes, and the split is AutoCAD's, not an arbitrary one:
 *
 *   - The *hiding* half asks which layer. LAYOFF, LAYFRZ, LAYLCK and LAYISO all prompt
 *     "select object on layer to ..." rather than acting on the current layer, because
 *     the thing you want out of the way is something you can see and point at - you
 *     rarely know its layer's name, which is the whole reason these commands exist
 *     instead of opening the Layer Properties Manager.
 *   - The *undoing* half needs no prompt. LAYON and LAYTHW act on every layer at once,
 *     because once a layer is off there is nothing left on screen to point at. LAYULK is
 *     the exception in AutoCAD - a locked layer is still visible, so it can still be
 *     picked - and it is kept that way here.
 *
 * Turning a layer off is a change to the drawing and goes through Transaction so it
 * undoes; isolating is not, and does not (see layerIsolation.ts).
 *
 * Nothing here redraws by hand. Every command in this file works by setting a property
 * on a Layer, and ThreeVisualContext already listens for that and re-runs
 * refreshLayerStyling itself (see its onLayerPropertyChanged) - unlike MOVETOLAYER and
 * COPYTOLAYER, which move a *node* between layers and so have to ask for the refresh.
 */

/**
 * The layers the picked objects sit on, each one once. Picking three lines that happen
 * to share a layer should turn one layer off, not run the same edit three times.
 */
function layersOf(document: IDocument, nodes: VisualNode[]): Layer[] {
    const seen = new Map<string, Layer>();
    nodes.forEach((node) => {
        const layer = document.modelManager.layerOf(node);
        if (!seen.has(layer.id)) seen.set(layer.id, layer);
    });
    return [...seen.values()];
}

/** "Select object on layer to X", then X applied to each distinct layer picked. */
abstract class PickedLayerCommand extends CancelableCommand {
    protected abstract readonly prompt: I18nKeys;
    protected abstract readonly transactionName: string;
    protected abstract apply(layer: Layer): void;

    /** True when this layer is already in the wanted state, so it needs no edit. */
    protected abstract isSatisfied(layer: Layer): boolean;

    protected async executeAsync(): Promise<void> {
        const picked = await this.pickLayers();
        // An empty pick is a cancel, not a failure - no toast, the prompt just ends.
        if (picked.length === 0) return;

        const targets = picked.filter((layer) => !this.isSatisfied(layer));
        // Everything picked was already off / frozen / locked. Committing here would put
        // an undo entry on the stack that undoes nothing.
        if (targets.length === 0) return;

        Transaction.execute(this.document, this.transactionName, () => {
            targets.forEach((layer) => {
                this.apply(layer);
            });
        });
    }

    protected async pickLayers(): Promise<Layer[]> {
        this.controller = new AsyncController();
        const picked = await this.document.picker.pickNode(this.prompt, this.controller, { multi: true });
        this.document.selection.clearSelection();
        return layersOf(this.document, picked);
    }
}

/** LAYON / LAYTHW: no prompt, because an off layer has nothing left to point at. */
abstract class AllLayersCommand implements ICommand {
    protected abstract readonly transactionName: string;
    protected abstract apply(layer: Layer): void;
    protected abstract isSatisfied(layer: Layer): boolean;

    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;

        const targets = document.modelManager.layers.filter((layer) => !this.isSatisfied(layer));
        if (targets.length === 0) return;

        Transaction.execute(document, this.transactionName, () => {
            targets.forEach((layer) => {
                this.apply(layer);
            });
        });
    }
}

@command({ key: "layer.off", icon: "icon-eye-slash" })
export class LayerOff extends PickedLayerCommand {
    protected readonly prompt: I18nKeys = "prompt.layer.selectOff";
    protected readonly transactionName = "layer off";

    protected isSatisfied(layer: Layer) {
        return !layer.visible;
    }

    protected apply(layer: Layer) {
        layer.visible = false;
    }
}

@command({ key: "layer.on", icon: "icon-eye" })
export class LayerOn extends AllLayersCommand {
    protected readonly transactionName = "layer on";

    protected isSatisfied(layer: Layer) {
        return layer.visible;
    }

    protected apply(layer: Layer) {
        layer.visible = true;
    }
}

@command({ key: "layer.freeze", icon: "icon-freeze" })
export class LayerFreeze extends PickedLayerCommand {
    protected readonly prompt: I18nKeys = "prompt.layer.selectFreeze";
    protected readonly transactionName = "layer freeze";

    protected isSatisfied(layer: Layer) {
        return layer.frozen;
    }

    protected apply(layer: Layer) {
        layer.frozen = true;
    }
}

@command({ key: "layer.thaw", icon: "icon-thaw" })
export class LayerThaw extends AllLayersCommand {
    protected readonly transactionName = "layer thaw";

    protected isSatisfied(layer: Layer) {
        return !layer.frozen;
    }

    protected apply(layer: Layer) {
        layer.frozen = false;
    }
}

@command({ key: "layer.lock", icon: "icon-lock" })
export class LayerLock extends PickedLayerCommand {
    protected readonly prompt: I18nKeys = "prompt.layer.selectLock";
    protected readonly transactionName = "layer lock";

    protected isSatisfied(layer: Layer) {
        return layer.locked;
    }

    protected apply(layer: Layer) {
        layer.locked = true;
    }
}

/**
 * LAYULK. Unlike its siblings this one still prompts: a locked layer is only
 * unselectable, not hidden, so there is still something on screen to point at.
 */
@command({ key: "layer.unlock", icon: "icon-unlock" })
export class LayerUnlock extends PickedLayerCommand {
    protected readonly prompt: I18nKeys = "prompt.layer.selectUnlock";
    protected readonly transactionName = "layer unlock";

    protected isSatisfied(layer: Layer) {
        return !layer.locked;
    }

    protected apply(layer: Layer) {
        layer.locked = false;
    }
}

/**
 * LAYISO: everything except the picked objects' layers goes away, so you can work on one
 * part of a drawing without the rest in the way.
 *
 * The picked layers are left exactly as they are rather than forced on - you just picked
 * an object on each, so they are visible by definition, and forcing would quietly thaw a
 * layer the user had frozen.
 */
@command({ key: "layer.isolate", icon: "icon-filter" })
export class LayerIsolate extends CancelableCommand {
    protected async executeAsync(): Promise<void> {
        this.controller = new AsyncController();
        const picked = await this.document.picker.pickNode("prompt.layer.selectIsolate", this.controller, {
            multi: true,
        });
        this.document.selection.clearSelection();
        if (picked.length === 0) return;

        const keep = new Set(layersOf(this.document, picked).map((layer) => layer.id));

        // Before anything is hidden, so LAYUNISO has somewhere to return to.
        captureIsolation(this.document);

        this.document.modelManager.layers.forEach((layer) => {
            if (!keep.has(layer.id)) layer.visible = false;
        });
    }
}

/**
 * LAYUNISO: puts back whatever LAYISO hid.
 *
 * Layers created while isolated are not in the snapshot and are left alone - they were
 * never hidden by the isolate, so there is nothing to restore them to.
 */
@command({ key: "layer.unisolate", icon: "icon-all" })
export class LayerUnisolate implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;

        const snapshot = isolationSnapshot(document);
        if (!snapshot) {
            PubSub.default.pub("showToast", "toast.layer.notIsolated");
            return;
        }

        document.modelManager.layers.forEach((layer) => {
            const state = snapshot.get(layer.id);
            if (!state) return;
            layer.visible = state.visible;
            layer.frozen = state.frozen;
        });

        clearIsolation(document);
    }
}
