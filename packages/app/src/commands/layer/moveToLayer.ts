// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, CancelableCommand, command, PubSub, Transaction, VisualNode } from "@chili3d/core";

/**
 * AutoCAD's "change object's layer": moves the selected objects onto whichever layer is
 * current. Uses the existing selection if there is one, otherwise asks for a pick -
 * matching how the other modify commands behave.
 */
@command({
    key: "layer.moveToCurrent",
    icon: "icon-layer",
})
export class MoveToCurrentLayer extends CancelableCommand {
    protected async executeAsync(): Promise<void> {
        const nodes = await this.selectedNodes();
        if (nodes.length === 0) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }

        const layerId = this.document.modelManager.currentLayerId;
        Transaction.execute(this.document, "move to layer", () => {
            nodes.forEach((node) => {
                node.layerId = layerId;
            });
        });

        // Layer membership changed, so colour / on-off / lock have to be re-resolved.
        this.document.visual.context.refreshLayerStyling();
        this.document.visual.update();
    }

    private async selectedNodes(): Promise<VisualNode[]> {
        const selected = this.document.selection
            .getSelectedNodes()
            .filter((x): x is VisualNode => x instanceof VisualNode);
        if (selected.length > 0) return selected;

        this.controller = new AsyncController();
        const picked = await this.document.picker.pickNode("prompt.select.models", this.controller, {
            multi: true,
        });
        this.document.selection.clearSelection();
        return picked.filter((x): x is VisualNode => x instanceof VisualNode);
    }
}
