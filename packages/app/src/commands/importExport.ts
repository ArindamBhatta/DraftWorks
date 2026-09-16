// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CancelableCommand,
    Combobox,
    command,
    download,
    I18n,
    type IApplication,
    type ICommand,
    type IConverter,
    PropertyUtils,
    PubSub,
    property,
    Result,
    readFilesAsync,
    SelectNodeStep,
} from "@draftworks/core";
import { importFiles } from "../utils";

@command({
    key: "file.import",
    icon: "icon-import",
})
export class Import implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const extenstions = application.dataExchange.importFormats().join(",");
        const files = await readFilesAsync(extenstions, true);
        if (!files.isOk || files.value.length === 0) {
            alert(files.error);
            return;
        }
        importFiles(application, files.value);
    }
}

/**
 * How each export format is named in the dropdown.
 *
 * A bare ".dwg" would not say which DWG the user is getting, and the version is the thing
 * they are usually being asked for - a client or an authority specifies a release, not
 * just a format. Both are R2000 here, for unrelated reasons: the DXF writer targets it as
 * the oldest revision that still carries everything a drawing holds, and DWG is pinned
 * there because it is the newest release LibreDWG's encoder produces.
 *
 * Formats with no entry fall back to the extension itself, so an IDataExchange
 * implementation offering something else still renders.
 */
const EXPORT_FORMAT_LABELS: Record<string, string> = {
    ".dwg": "DWG (AutoCAD 2000)",
    ".dxf": "DXF (AutoCAD 2000)",
};

const exportFormatConverter: IConverter<string> = {
    convert: (format: string) => Result.ok(EXPORT_FORMAT_LABELS[format] ?? format),
};

@command({
    key: "file.export",
    icon: "icon-export",
})
export class Export extends CancelableCommand {
    @property("file.format", {
        combobox: new Combobox<string>(exportFormatConverter),
    })
    public get format() {
        return this.getPrivateValue("format", ".dxf");
    }
    public set format(value: string) {
        this.setProperty("format", value);
    }

    constructor() {
        super();
        const property = PropertyUtils.getProperty(Export.prototype, "format")!;
        property.combobox!.items.clear();
        // In the constructor, this.application has not been assigned yet, so use the global app.
        property.combobox!.items.push(...app.dataExchange.exportFormats());
        const index = property.combobox!.items.indexOf(this.format);
        property.combobox!.selectedIndex = index < 0 ? 0 : index;
    }

    protected async executeAsync() {
        const nodes = await this.selectNodesAsync();
        if (!nodes || nodes.length === 0) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }

        PubSub.default.pub(
            "showPermanent",
            async () => {
                const data = await this.application.dataExchange.export(this.format, nodes);
                if (!data) return;

                PubSub.default.pub("showToast", "toast.downloading");
                download(data, `${nodes[0].name}${this.format}`);
            },
            "toast.excuting{0}",
            I18n.translate("command.file.export"),
        );
    }

    private async selectNodesAsync() {
        this.controller = new AsyncController();
        const step = new SelectNodeStep("prompt.select.models", { multiple: true, keepSelection: true });
        const data = await step.execute(this.application.activeView?.document!, this.controller);
        if (!data?.nodes) {
            PubSub.default.pub("showToast", "prompt.select.noModelSelected");
            return undefined;
        }
        return data.nodes;
    }
}
