import type { IShapeConverter, IShapeFactory, IShapeProvider } from "@draftworks/core";
import { OccShapeConverter } from "./converter";
import { ShapeFactory } from "./factory";

export class OccShapeProvider implements IShapeProvider {
    readonly factory: IShapeFactory;
    readonly converter: IShapeConverter;

    constructor() {
        this.factory = new ShapeFactory();
        this.converter = new OccShapeConverter();
    }
}
