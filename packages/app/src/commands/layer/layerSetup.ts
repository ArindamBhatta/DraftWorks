import { command, type IApplication, type ICommand, PubSub } from "@draftworks/core";

/**
 * AutoCAD's LAYER (LA): opens the Layer Properties Manager, where layers are made,
 * renamed, coloured, locked, turned on/off, and made current.
 */
@command({
    key: "layer.setup",
    icon: "icon-layer-group",
})
export class LayerSetup implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;

        PubSub.default.pub("showLayerPanel", document);
    }
}
