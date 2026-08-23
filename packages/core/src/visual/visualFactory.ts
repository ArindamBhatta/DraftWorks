import type { IDocument } from "../document";
import type { IVisual } from "./visual";

export interface IVisualFactory {
    readonly kernelName: string;
    create(document: IDocument): IVisual;
}
