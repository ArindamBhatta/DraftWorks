import {
    AsyncController,
    CancelableCommand,
    command,
    type I18nKeys,
    PubSub,
    Transaction,
    type VisualNode,
} from "@chili3d/core";

/**
 * AutoCAD's COPYTOLAYER:
 *
 *     Select objects:
 *     Select object on destination layer or [Name]:
 *
 * Leaves the originals where they are and puts a copy of each on the destination layer,
 * in place - nothing moves. It is the command for "these walls should also exist as
 * setting-out lines on another layer", where MOVETOLAYER would take the original away.
 *
 * The destination is picked as an object rather than typed as a name, which is the half
 * of AutoCAD's prompt people actually use: the layer you want is almost always one you
 * can already see something on. The [Name] branch is not offered, because this app's
 * Layer Properties Manager is where a layer gets chosen by name.
 */
@command({ key: "layer.copyToNew", icon: "icon-clone" })
export class CopyToLayer extends CancelableCommand {
    protected async executeAsync(): Promise<void> {
        const sources = await this.pick("prompt.layer.selectCopy", true);
        if (sources.length === 0) return;

        const destination = await this.pick("prompt.layer.selectDestination", false);
        if (destination.length === 0) return;

        const layerId = this.document.modelManager.layerOf(destination[0]).id;

        // Copying onto the layer the objects are already on would just litter the
        // drawing with coincident duplicates, which reads as the command having done
        // nothing - say so instead.
        const targets = sources.filter((node) => node.layerId !== layerId);
        if (targets.length === 0) {
            PubSub.default.pub("showToast", "toast.layer.sameDestination");
            return;
        }

        Transaction.execute(this.document, "copy to layer", () => {
            targets.forEach((node) => {
                const copy = node.clone();
                copy.layerId = layerId;
                node.parent?.insertAfter(node, copy);
            });
        });

        this.document.visual.context.refreshLayerStyling();
        this.document.visual.update();
    }

    private async pick(prompt: I18nKeys, multi: boolean) {
        this.controller = new AsyncController();
        const picked = await this.document.picker.pickNode(prompt, this.controller, { multi });
        this.document.selection.clearSelection();
        return picked as VisualNode[];
    }
}
