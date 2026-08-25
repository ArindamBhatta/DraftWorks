// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type GeometryNode, MultistepCommand, property, Transaction } from "@chili3d/core";

const count = 1;

// CreateCommand is the base for every "draw a shape" command (Box, Circle, Line, ...).
// It wraps body construction (geometryNode()) and tree insertion (addNode()) in a
// single Transaction so undo/redo sees one atomic "create" step, even though two
// separate calls happen - without this, undoing a create could theoretically leave
// a constructed-but-unattached body or an attached-but-unconstructed node depending
// on where the operation was interrupted. geometryNode() is the one abstract seam
// each concrete create-command implements: it turns the interactive step data
// (points/lengths the user clicked/typed, collected by MultistepCommand) into a
// body instance - see create/box.ts and create/circle.ts for concrete examples, and
// core/src/model/shapeNode.ts (ParameterShapeNode) for what happens to that body next.
export abstract class CreateCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = this.geometryNode();
            this.document.modelManager.addNode(node);
            this.document.visual.update();
        });
    }

    protected abstract geometryNode(): GeometryNode;
}

export abstract class CreateNodeCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.document.modelManager.addNode(this.getNode());
            this.document.visual.update();
        });
    }

    protected abstract getNode(): GeometryNode;
}

// The command-level mirror of FacebaseNode.isFace (core/src/model/facebaseNode.ts):
// this exposes the "cap as a face?" toggle as a command property (bound to a ribbon
// checkbox) so the user can choose it before drawing, and concrete commands (e.g.
// Circle.geometryNode() below) copy this onto the body they create. The default is
// true here versus false on the body itself: a freshly-created circle/rect defaults
// to a face in the UI, but a body deserialized without explicit isFace defaults to
// a bare edge/wire.
export abstract class CreateFaceableCommand extends CreateCommand {
    @property("option.command.isFace")
    public get isFace() {
        return this.getPrivateValue("isFace", true);
    }
    public set isFace(value: boolean) {
        this.setProperty("isFace", value);
    }
}
