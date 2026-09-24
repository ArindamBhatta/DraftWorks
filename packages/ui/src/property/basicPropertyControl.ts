import { type IDocument, Logger, type Property } from "@draftworks/core";
import { LengthConverter } from "@draftworks/element";
import { CheckProperty } from "./check";
import { ColorProperty } from "./colorProperty";
import { InputProperty } from "./input";
import { LineTypeProperty } from "./lineTypeProperty";
import { MaterialProperty } from "./materialProperty";

const LENGTH = new LengthConverter();

export function basicPropertyControl(document: IDocument, objs: any[], prop: Property) {
    if (prop === undefined || objs.length === 0) return "";

    if (prop.type === "color") {
        return new ColorProperty(document, objs, prop);
    }

    if (prop.type === "lineType") {
        return new LineTypeProperty(document, objs, prop);
    }

    // A distance reads in the drawing's units, the same as the coordinate rows above it.
    if (prop.type === "length") {
        return new InputProperty(document, objs, { ...prop, converter: prop.converter ?? LENGTH });
    }

    if (prop.type === "materialId" && canShowMaterialProperty(objs, prop)) {
        return new MaterialProperty(document, objs, prop);
    }

    const value = objs[0][prop.name];
    if (["object", "string", "number"].includes(typeof value)) {
        return new InputProperty(document, objs, prop);
    }

    if (typeof value === "boolean") {
        return new CheckProperty(document, objs, prop);
    }

    Logger.warn(`Property ${prop.name} not found in ${Object.getPrototypeOf(objs[0]).constructor.name}`);
    return "";
}

function canShowMaterialProperty(objs: any[], prop: Property) {
    if (objs.length === 0) return false;
    if (objs.length === 1) return true;
    return objs.every((obj) => obj[prop.name] === objs[0][prop.name]);
}
