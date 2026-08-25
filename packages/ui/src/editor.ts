// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IApplication,
    type ICommand,
    type IDocument,
    type Material,
    PubSub,
    type Ribbon,
} from "@chili3d/core";
import { div } from "@chili3d/element";
import { CommandLine } from "./commandLine";
import style from "./editor.module.css";
import { MaterialDataContent, MaterialEditor } from "./property/material";
import { RibbonUI } from "./ribbon";
import { CommandContext } from "./ribbon/commandContext";
import { Statusbar } from "./statusbar";
import { LayoutViewport } from "./viewport";

/**
 * The whole window below the ribbon: drawing area, command line, status bar.
 *
 * There is no sidebar. The document tree and the properties list used to live down the
 * left; properties are now AutoCAD's floating palette, opened on demand by the PROPERTIES
 * command (`PR`), which leaves the drawing the full width of the window.
 */
export class Editor extends HTMLElement {
    private readonly _viewportContainer: HTMLDivElement;
    private readonly _commandContextContainer = div({});
    private commandContext?: CommandContext;

    constructor(
        readonly app: IApplication,
        readonly ribbonContent: Ribbon,
    ) {
        super();
        const viewport = new LayoutViewport(app);
        viewport.classList.add(style.viewport);
        this._viewportContainer = div({ className: style.viewportContainer }, viewport);
        this.render();
    }

    private render() {
        this.append(
            div(
                { className: style.root },
                new RibbonUI(this.app, this.ribbonContent),
                div({ className: style.content }, this._viewportContainer),
                new CommandLine(style.commandLine),
                new Statusbar(style.statusbar),
            ),
        );
        this.app.mainWindow?.appendChild(this);
    }

    connectedCallback(): void {
        PubSub.default.sub("editMaterial", this._handleMaterialEdit);
        PubSub.default.sub("openCommandContext", this.openContext);
        PubSub.default.sub("closeCommandContext", this.closeContext);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("editMaterial", this._handleMaterialEdit);
        PubSub.default.remove("openCommandContext", this.openContext);
        PubSub.default.remove("closeCommandContext", this.closeContext);
    }

    private readonly openContext = (command: ICommand) => {
        if (this.commandContext) {
            this.closeContext();
        }
        this.commandContext = new CommandContext(command);
        this._commandContextContainer.append(this.commandContext);
        this._viewportContainer.append(this._commandContextContainer);
    };

    private readonly closeContext = () => {
        this.commandContext?.remove();
        this.commandContext?.dispose();
        this.commandContext = undefined;
        this._commandContextContainer.innerHTML = "";
    };

    private readonly _handleMaterialEdit = (
        document: IDocument,
        editingMaterial: Material,
        callback: (material: Material) => void,
    ) => {
        const context = new MaterialDataContent(document, callback, editingMaterial);
        this._viewportContainer.append(new MaterialEditor(context));
    };
}

customElements.define("chili-editor", Editor);
