import { type GeometryNode, MultiStepCommand, Transaction } from "@draftworks/core";

// CreateCommand is the base for every "draw a shape" command (Box, Circle, Line, ...).
// It wraps body construction (geometryNode()) and tree insertion (addNode()) in a
// single Transaction so undo/redo sees one atomic "create" step, even though two
// separate calls happen - without this, undoing a create could theoretically leave
// a constructed-but-unattached body or an attached-but-unconstructed node depending
// on where the operation was interrupted. geometryNode() is the one abstract seam
// each concrete create-command implements: it turns the interactive step data
// (points/lengths the user clicked/typed, collected by MultiStepCommand) into a
// body instance - see create/box.ts and create/circle.ts for concrete examples, and
// core/src/model/shapeNode.ts (ParameterShapeNode) for what happens to that body next.
export abstract class CreateCommand extends MultiStepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = this.geometryNode();
            this.document.modelManager.addNode(node);
            this.document.visual.update();
        });
    }

    protected abstract geometryNode(): GeometryNode;
}

export abstract class CreateNodeCommand extends MultiStepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.document.modelManager.addNode(this.getNode());
            this.document.visual.update();
        });
    }

    protected abstract getNode(): GeometryNode;
}

// There is deliberately no face toggle here. This is a 2D drafting app: drawing a
// circle produces a circle - an edge - the way CIRCLE does in AutoCAD, and filling a
// region is HATCH's job, laid over the boundary as its own object rather than being a
// property of the boundary. The toggle came from Chili3d, where capping a planar curve
// into a face is the first step of a 3D operation; here it only offered a second,
// uneditable way to fill something that competed with the real one. FacebaseNode.isFace
// still exists on the bodies so older drawings keep deserializing - see
// core/src/model/facebaseNode.ts.
