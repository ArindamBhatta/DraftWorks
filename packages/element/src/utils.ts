import { Localize, PathBinding } from "@draftworks/core";
import type { HTMLProps } from "./htmlProps";

export function setProperties<T extends { [K: string]: any }>(left: T, prop: HTMLProps<T>) {
    for (const key in prop) {
        const value = prop[key];
        if (value instanceof Localize && (key === "textContent" || key === "title")) {
            value.set(left, key);
        } else if (value instanceof PathBinding) {
            value.setBinding(left, key);
        } else if (typeof value === "object" && typeof left[key] === "object") {
            setProperties(left[key], value);
        } else {
            (left as any)[key] = value;
        }
    }
}

export function toBase64Img(fileName: string, base64Str: string) {
    let base64: string;
    if (fileName.endsWith("png")) {
        base64 = `data:image/png;base64,${base64Str}`;
    } else if (fileName.endsWith("svg")) {
        base64 = `data:image/svg+xml;base64,${base64Str}`;
    } else if (fileName.endsWith("jpg")) {
        base64 = `data:image/jpeg;base64,${base64Str}`;
    } else {
        throw "Unsupported icon format, only png, jpg, svg are supported";
    }
    return base64;
}
