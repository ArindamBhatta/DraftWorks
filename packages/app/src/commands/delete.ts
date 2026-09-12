import {
    command,
    GetOrSelectNodeStep,
    type INode,
    type IStep,
    MultiStepCommand,
    PubSub,
    Transaction,
} from "@draftworks/core";

@command({
    key: "modify.deleteNode",
    icon: "icon-delete",
})
export class Delete extends MultiStepCommand {
    protected override executeMainTask(): void {
        const nodes: INode[] | undefined = this.stepDatas[0].nodes;
        if (!nodes || nodes.length === 0) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }

        if (
            this.document.modelManager.currentNode &&
            nodes.includes(this.document.modelManager.currentNode)
        ) {
            this.document.modelManager.currentNode = this.document.modelManager.rootNode;
        }

        this.document.selection.clearSelection();
        Transaction.execute(this.document, "delete", () => {
            nodes.forEach((model) => model.parent?.remove(model));
        });
        this.document.visual.update();
        PubSub.default.pub("showToast", "toast.delete{0}Objects", nodes.length);
    }

    protected override getSteps(): IStep[] {
        return [new GetOrSelectNodeStep("prompt.select.models", { multiple: true })];
    }
}
