import { command, type IApplication, type ICommand } from "@draftworks/core";

@command({
    key: "edit.undo",
    icon: "icon-undo",
})
export class Undo implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        document?.history.undo();
        document?.visual.update();
    }
}
