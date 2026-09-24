import { type IConverter, type IDocument, type Property, Texture } from "@draftworks/core";
import { basicPropertyControl } from "./basicPropertyControl";
import { TextureProperty } from "./textureProperty";

export function propertyControl(document: IDocument, objs: any[], prop: Property) {
    if (prop === undefined || objs.length === 0) return "";

    const value = objs[0][prop.name];
    if (value instanceof Texture) {
        return new TextureProperty(document, prop.display, value);
    }

    return basicPropertyControl(document, objs, prop);
}
