import type { IDocument, IEventHandler, IVisual, IVisualFactory } from "@draftworks/core";

import { ThreeVisual } from "./threeVisual";

export class ThreeVisulFactory implements IVisualFactory {
    readonly kernelName = "three";

    constructor(readonly createEventHandler: (document: IDocument) => IEventHandler) {}

    create(document: IDocument): IVisual {
        return new ThreeVisual(document, this.createEventHandler(document));
    }
}
