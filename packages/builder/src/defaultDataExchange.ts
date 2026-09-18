import {
    DxfParseError,
    detectDrawingFormat,
    dimensionStylesForExport,
    dwgVersionName,
    dxfToNodes,
    nodesToDxf,
    readDxf,
    writeDxf,
} from "@draftworks/app";
import { I18n, type IDataExchange, type IDocument, PubSub, type VisualNode } from "@draftworks/core";

/**
 * DWG and DXF, both directions.
 *
 * DWG is what drawings are actually exchanged as. It is AutoCAD's native format - closed
 * and undocumented, unlike DXF - but that is a fact about how it has to be handled, not a
 * reason to refuse it. Telling a user to convert their DWG in AutoCAD first is not a
 * workaround, because anyone who has AutoCAD does not need this application. So DWG is
 * imported directly, converted to DXF by LibreDWG compiled to WebAssembly, and handed to
 * the DXF reader. The conversion is invisible and entirely local: nothing is uploaded.
 *
 * Export runs the same path backwards - our DXF writer's output goes through LibreDWG's
 * encoder - and lands on AutoCAD R2000. That is not a default but the ceiling: LibreDWG
 * writes R13-R2000 and nothing above it. The format is labelled with that version rather
 * than left ambiguous, because a user choosing an export format is entitled to know which
 * one they are getting. It costs them nothing, since DWG readers are backward compatible
 * and an R2000 file opens in every AutoCAD released since.
 *
 * The solid-modelling exchange formats that used to be here (STEP, IGES, BREP) are gone:
 * they carry B-Rep solids and surfaces, which is the wrong shape of data for a drawing
 * made of lines, arcs, text and dimensions - a drawing exported to STEP loses every
 * annotation and every layer, which is most of what the drawing was.
 *
 * The reading and writing themselves live in packages/app/src/io/dxf - see the notes
 * there on what survives a round trip.
 */
export class DefaultDataExchange implements IDataExchange {
    importFormats(): string[] {
        // DWG first: it is what the file picker should suggest, because it is what the
        // user is most likely holding.
        return [".dwg", ".dxf"];
    }

    exportFormats(): string[] {
        // DWG first, for the same reason as import: it is what the drawing will be sent
        // on as. The labels these map to live in EXPORT_FORMAT_LABELS.
        return [".dwg", ".dxf"];
    }

    async import(document: IDocument, files: FileList | File[]): Promise<void> {
        for (const file of files) {
            await this.importSingleFile(document, file);
        }
    }

    private async importSingleFile(document: IDocument, file: File): Promise<void> {
        let bytes: Uint8Array;
        try {
            bytes = new Uint8Array(await file.arrayBuffer());
        } catch (error) {
            PubSub.default.pub("showToast", "error.default:{0}", String(error));
            return;
        }

        const content = await this.readAsDxf(bytes, file.name);
        if (content === undefined) return;

        let result: ReturnType<typeof dxfToNodes>;
        try {
            const drawing = readDxf(content);
            result = dxfToNodes(document, drawing, file.name);
        } catch (error) {
            const message =
                error instanceof DxfParseError ? I18n.translate("error.import.notDrawing") : String(error);
            PubSub.default.pub("showToast", "error.default:{0}", message);
            return;
        }

        if (result.imported === 0) {
            PubSub.default.pub("showToast", "error.import.emptyDxf:{0}", file.name);
            return;
        }

        document.modelManager.addNode(result.node);
        document.visual.update();

        if (result.unsupported.length > 0) {
            PubSub.default.pub(
                "showToast",
                "toast.import.skippedEntities:{0}",
                result.unsupported.join(", "),
            );
        }
    }

    /**
     * Gets ASCII DXF text out of whatever the user picked, converting DWG on the way.
     * Returns undefined after reporting a toast, so callers can just bail.
     */
    private async readAsDxf(bytes: Uint8Array, name: string): Promise<string | undefined> {
        switch (detectDrawingFormat(bytes)) {
            case "dxf":
                return new TextDecoder("utf-8").decode(bytes);

            case "dwg": {
                // Checked before loading 6 MB of decoder that could not read it anyway.
                if (dwgVersionName(bytes) === undefined) {
                    PubSub.default.pub("showToast", "error.import.dwgVersion:{0}", name);
                    return undefined;
                }
                // Loaded on demand - see the note in packages/wasm/src/dwg.ts. A large
                // DWG takes a moment, so the conversion runs behind the busy indicator.
                const { DwgReadError, dwgToDxf } = await import("@draftworks/wasm");
                try {
                    return await dwgToDxf(bytes);
                } catch (error) {
                    const message =
                        error instanceof DwgReadError
                            ? I18n.translate("error.import.dwgUnreadable:{0}", name)
                            : String(error);
                    PubSub.default.pub("showToast", "error.default:{0}", message);
                    return undefined;
                }
            }

            // Binary DXF is a rarity that neither the DXF reader nor the DWG decoder
            // covers, so it gets its own message rather than a generic "not a drawing".
            case "dxf-binary":
                PubSub.default.pub("showToast", "error.import.binaryDxf:{0}", name);
                return undefined;

            default:
                PubSub.default.pub("showToast", "error.import.unsupportedFileType:{0}", name);
                return undefined;
        }
    }

    async export(type: string, nodes: VisualNode[]): Promise<BlobPart[] | undefined> {
        if ((type !== ".dxf" && type !== ".dwg") || nodes.length === 0) return undefined;

        const document = nodes[0].document;
        const { drawing, skipped } = nodesToDxf(nodes, [...document.modelManager.layers]);

        if (drawing.entities.length === 0) {
            PubSub.default.pub("showToast", "error.export.noNodeCanBeExported");
            return undefined;
        }
        if (skipped > 0) {
            PubSub.default.pub("showToast", "toast.export.skippedNodes:{0}", String(skipped));
        }

        // Both formats are written by the DXF writer. DWG is that same text encoded a
        // second time, so anything the writer cannot express is already lost before
        // LibreDWG sees it - the round-trip notes in packages/app/src/io/dxf apply to
        // DWG exactly as they do to DXF.
        const dxf = writeDxf(drawing, { dimensionStyles: dimensionStylesForExport() });
        if (type === ".dxf") return [dxf];

        return this.encodeAsDwg(dxf);
    }

    /**
     * Encodes finished DXF text as an R2000 DWG, or reports a toast and returns undefined.
     *
     * There is no fallback to handing back the DXF instead. The user picked DWG, and a
     * file with a .dwg name that is really DXF inside is worse than a failed export: it
     * gets forwarded to someone whose software opens it by extension.
     */
    private async encodeAsDwg(dxf: string): Promise<BlobPart[] | undefined> {
        // Loaded on demand, the same module the import side uses - see the note in
        // packages/wasm/src/dwg.ts. Encoding takes a moment on a large drawing, which is
        // why export already runs behind the busy indicator.
        const { DwgWriteError, dxfToDwg } = await import("@draftworks/wasm");
        try {
            return [await dxfToDwg(dxf)];
        } catch (error) {
            const message =
                error instanceof DwgWriteError ? I18n.translate("error.export.dwgFailed") : String(error);
            PubSub.default.pub("showToast", "error.default:{0}", message);
            return undefined;
        }
    }
}
