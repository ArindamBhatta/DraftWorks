import { I18n, type I18nKeys, type INode, NodeUtils, PubSub } from "@draftworks/core";
import { a, svg } from "@draftworks/element";
import type { ProjectView } from "./projectView";
import style from "./toolBar.module.css";
import type { Tree } from "./tree";
import { TreeGroup } from "./tree/treeItemGroup";

export class ToolBar extends HTMLElement {
    constructor(readonly projectView: ProjectView) {
        super();
        this.className = style.panel;
        this.render();
    }

    private render() {
        const buttons = [
            { icon: "icon-folder-plus", tip: "items.tool.newFolder", command: this.newGroup },
            { icon: "icon-unexpand", tip: "items.tool.unexpandAll", command: this.unExpandAll },
            { icon: "icon-expand", tip: "items.tool.expandAll", command: this.expandAll },
        ];
        buttons.forEach(({ icon, tip, command }) => this.button(icon, tip as I18nKeys, command));
    }

    private button(icon: string, tip: I18nKeys, command: () => void) {
        this.append(
            a(
                { title: I18n.translate(tip) },
                svg({
                    icon,
                    className: style.svg,
                    onclick: command,
                }),
            ),
        );
    }

    private readonly newGroup = () => {
        PubSub.default.pub("executeCommand", "create.folder");
    };

    private readonly expandAll = () => {
        this.setExpand(true);
    };

    private readonly unExpandAll = () => {
        this.setExpand(false);
    };

    private setExpand(expand: boolean) {
        const tree = this.projectView.activeTree();
        if (!tree) return;
        const first = this.projectView.activeDocument?.modelManager.rootNode.firstChild;
        if (first) this.setNodeExpand(tree, first, expand);
    }

    private setNodeExpand(tree: Tree, list: INode, expand: boolean) {
        // Iterative along siblings - see the note in Tree.addAllNodes. Expand/collapse all
        // runs over every node in the document, so an imported drawing overflowed here too.
        const stack: INode[] = [list];

        while (stack.length > 0) {
            const node = stack.pop()!;
            const item = tree.treeItem(node);
            if (item instanceof TreeGroup) {
                item.isExpanded = expand;
            }

            if (node.nextSibling) stack.push(node.nextSibling);
            if (NodeUtils.isLinkedListNode(node) && node.firstChild) stack.push(node.firstChild);
        }
    }
}

customElements.define("chili-toolbar", ToolBar);
