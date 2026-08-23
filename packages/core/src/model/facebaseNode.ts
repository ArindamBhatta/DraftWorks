import { property } from "../property";
import { serialize } from "../serialize";
import { ParameterShapeNode } from "./shapeNode";

// FacebaseNode adds one concern - "should this planar curve also cap itself into a
// face?" - as its own thin layer rather than folding isFace into ParameterShapeNode
// directly, because only planar-curve-producing bodies (circle, rect, polygon,
// ellipse, regularPolygon - see packages/app/src/bodys/) ever need the toggle; a
// solid-producing body like BoxNode has no use for it. Keeping it scoped here keeps
// the more general ParameterShapeNode free of a concept most of its subclasses don't
// need. The toggle is set from the command side too: CreateFaceableCommand.isFace
// (packages/app/src/commands/createCommand.ts) seeds this property when a body is
// first created, and each body's generateShape() reads it to decide whether to
// return a bare edge/wire or convert it to a face (see e.g. CircleNode.generateShape
// in packages/app/src/bodys/circle.ts).
export abstract class FacebaseNode extends ParameterShapeNode {
    @serialize()
    @property("option.command.isFace")
    get isFace() {
        return this.getPrivateValue("isFace", false);
    }
    set isFace(value: boolean) {
        this.setPropertyEmitShapeChanged("isFace", value);
    }
}
