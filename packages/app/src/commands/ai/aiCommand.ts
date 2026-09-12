import { command, type IApplication, type ICommand } from "@draftworks/core";
import { showAiPanel } from "./aiPanel";

/**
 * Opens the AI Draft panel. It is a palette rather than a modal because drafting is a
 * conversation - the request, what came back, and the correction all stay visible while
 * the drawing is on the canvas beside them.
 */
@command({ key: "ai.draft", icon: "icon-rect" })
export class AiDraftCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        showAiPanel(application);
    }
}
