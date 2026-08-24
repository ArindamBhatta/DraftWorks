// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    I18n,
    type IDataExchange,
    type IDocument,
    type INode,
    type IShape,
    PubSub,
    Result,
    ShapeNode,
    type VisualNode,
} from "@chili3d/core";

// Only the CAD exchange formats that carry 2D curve geometry. The mesh formats
// (STL/PLY/OBJ) are gone: importing one produces a 3D triangle mesh, and exporting a
// 2D drawing to one produces nothing useful - neither belongs in a 2D drafting app.
export class DefaultDataExchange implements IDataExchange {
    importFormats(): string[] {
        return [".step", ".stp", ".iges", ".igs", ".brep"];
    }

    exportFormats(): string[] {
        return [".step", ".iges", ".brep"];
    }

    async import(document: IDocument, files: FileList | File[]): Promise<void> {
        for (const file of files) {
            await this.handleSingleFileImport(document, file);
        }
    }

    private async handleSingleFileImport(document: IDocument, file: File) {
        let importResult: Result<INode> | undefined;

        const fileName = file.name.toLocaleLowerCase();
        if (this.extensionIs(fileName, ".brep")) {
            importResult = await this.importBrep(document, file);
        } else if (this.extensionIs(fileName, ".step", ".stp")) {
            importResult = await this.importStep(document, file);
        } else if (this.extensionIs(fileName, ".iges", ".igs")) {
            importResult = await this.importIges(document, file);
        }

        this.handleImportResult(document, fileName, importResult);
    }

    private extensionIs(fileName: string, ...extensions: string[]): boolean {
        return extensions.some((ext) => fileName.endsWith(ext));
    }

    private handleImportResult(document: IDocument, name: string, nodeResult: Result<INode> | undefined) {
        if (!nodeResult?.isOk) {
            alert(I18n.translate("error.import.unsupportedFileType:{0}", name));
            return;
        }

        const node = nodeResult.value;
        node.name = name;
        document.modelManager.addNode(node);
        document.visual.update();
    }

    async importBrep(document: IDocument, file: File) {
        const shape = shapeConverter.convertFromBrep(await file.text());
        if (!shape.isOk) {
            return Result.err(shape.error);
        }
        return Result.ok(new EditableShapeNode({ document, name: file.name, shape: shape.value }));
    }

    private async importIges(document: IDocument, file: File) {
        const content = new Uint8Array(await file.arrayBuffer());
        return shapeConverter.convertFromIGES(document, content);
    }

    private async importStep(document: IDocument, file: File) {
        const content = new Uint8Array(await file.arrayBuffer());
        return shapeConverter.convertFromSTEP(document, content);
    }

    async export(type: string, nodes: VisualNode[]): Promise<BlobPart[] | undefined> {
        if (nodes.length === 0) return undefined;

        const document = nodes[0].document;
        let shapeResult: Result<BlobPart> | undefined;
        const shapes = this.getExportShapes(nodes);
        if (!shapes.length) return undefined;
        if (type === ".step") shapeResult = this.exportStep(document, shapes);
        if (type === ".iges") shapeResult = this.exportIges(document, shapes);
        if (type === ".brep") shapeResult = this.exportBrep(document, shapes);

        if (shapeResult) {
            return this.handleExportResult(shapeResult);
        }
        return undefined;
    }

    private getExportShapes(nodes: VisualNode[]): IShape[] {
        const shapes = nodes
            .filter((x): x is ShapeNode => x instanceof ShapeNode)
            .map((x) => x.shape.value.transformedMul(x.worldTransform()));

        !shapes.length && PubSub.default.pub("showToast", "error.export.noNodeCanBeExported");
        return shapes;
    }

    private exportStep(doc: IDocument, shapes: IShape[]) {
        return shapeConverter.convertToSTEP(...shapes);
    }

    private exportIges(doc: IDocument, shapes: IShape[]) {
        return shapeConverter.convertToIGES(...shapes);
    }

    private exportBrep(document: IDocument, shapes: IShape[]) {
        const comp = shapeFactory.combine(shapes);
        if (!comp.isOk) {
            return Result.err(comp.error);
        }

        const result = shapeConverter.convertToBrep(comp.value);
        comp.value.dispose();
        return result;
    }

    private handleExportResult(result: Result<BlobPart> | undefined) {
        if (!result?.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", result?.error);
            return undefined;
        }
        return [result.value];
    }
}
