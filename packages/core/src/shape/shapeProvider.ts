import type { IShapeConverter } from "./shapeConverter";
import type { IShapeFactory } from "./shapeFactory";

export interface IShapeProvider {
    readonly factory: IShapeFactory;
    readonly converter: IShapeConverter;
}
