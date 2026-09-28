import { command, type IApplication, type ICommand, PubSub } from "@draftworks/core";

/**
 * AutoCAD's PROPERTIES (PR, CH, MO, PROPS): pick an object, type PR, press Enter, and
 * the palette opens on what is selected. Editing a value there edits the object, and the
 * palette follows the selection from then on.
 *
 * This is the only way into the properties now that the sidebar is gone, so it opens the
 * palette even with nothing selected - the palette says so itself, which is friendlier
 * than a command that appears to do nothing. AutoCAD behaves the same way.
 */
@command({
    key: "modify.properties",
    icon: "icon-edit",
})
export class Properties implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;

        // Read the selection here, not in the panel: CommandService blanks the open
        // properties UI as every command starts, so the palette needs telling again.
        PubSub.default.pub("showPropertiesPanel", document, document.selection.getSelectedNodes());
    }
}
