// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, type IApplication, type ICommand } from "@draftworks/core";
import { promptDrawingSetup } from "../drawingSetupFlow";

let count = 1;

@command({
    key: "doc.new",
    icon: "icon-new",
    isApplicationCommand: true,
})
export class NewDocument implements ICommand {
    async execute(app: IApplication): Promise<void> {
        // AutoCAD-style: ask for the drawing's units, dimension style and MVSETUP
        // before handing over a blank canvas. Every prompt in the chain resolves
        // whether the user confirms or cancels, so this never blocks starting a new
        // drawing - it just applies whatever was confirmed first.
        await promptDrawingSetup();
        await app.newDocument(`Drawing${count++}`);
    }
}
