import type { IDocument, INode } from "@draftworks/core";
import { TreeItem } from "./treeItem";
import style from "./treeModel.module.css";

export class TreeModel extends TreeItem {
    constructor(document: IDocument, node: INode) {
        super(document, node);
        this.append(this.name, this.visibleIcon);
        this.classList.add(style.panel);
    }

    mainElement(): HTMLElement {
        return this;
    }
}

customElements.define("tree-model", TreeModel);
