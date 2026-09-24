import { command, FolderNode, type IApplication, type ICommand } from "@draftworks/core";

let index = 1;

@command({
    key: "create.folder",
    icon: "icon-folder-plus",
})
export class NewFolder implements ICommand {
    async execute(app: IApplication): Promise<void> {
        const document = app.activeView?.document!;
        const folder = new FolderNode({ document, name: `Folder${index++}` });
        document.modelManager.addNode(folder);
    }
}
