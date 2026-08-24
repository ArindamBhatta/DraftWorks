// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, CancelableCommand, command, PanEventHandler } from "@chili3d/core";

/**
 * AutoCAD's PAN. Runs until cancelled (ESC/ENTER, or any other command starting), with
 * the left button dragging the view - see PanEventHandler. Picker.pickAsync does the
 * handler swap, cursor and status-bar tip for us; nothing is being picked here, so
 * `showControl` is false and the returned selection is ignored.
 */
@command({
    key: "view.pan",
    icon: "icon-arrows",
})
export class PanCommand extends CancelableCommand {
    protected async executeAsync(): Promise<void> {
        this.controller = new AsyncController();
        const handler = new PanEventHandler(this.controller);
        this.disposeStack.add(handler);

        await this.document.picker.pickAsync(handler, "prompt.pan", this.controller, false, "pan");
    }
}
