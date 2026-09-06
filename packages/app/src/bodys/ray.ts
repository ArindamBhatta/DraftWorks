import {
    type I18nKeys,
    type IDocument,
    type IShape,
    ParameterShapeNode,
    property,
    type Result,
    serializable,
    serialize,
    type XYZ,
} from "@chili3d/core";

export interface RayOptions {
    document: IDocument;
    start: XYZ;
    end: XYZ;
}

// A ray is a straight edge from `start` through `end`, stretched far past `end`
// by the create.ray command (see commands/create/ray.ts) so it reads as
// "infinite" in one direction, the way AutoCAD's RAY command behaves. The
// geometry kernel has no true infinite-edge primitive, so this is a practical
// stand-in - structurally identical to LineNode (see line.ts), kept as its own
// class only so it serializes/displays as "Ray" rather than "Line".
// 2D-compatible - a pure curve (edge), always compatible with a 2D drafting build.
@serializable()
export class RayNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.ray";
    }

    @serialize()
    @property("line.start")
    get start() {
        return this.getPrivateValue("start");
    }
    set start(pnt: XYZ) {
        this.setPropertyEmitShapeChanged("start", pnt);
    }

    @serialize()
    @property("line.end")
    get end() {
        return this.getPrivateValue("end");
    }
    set end(pnt: XYZ) {
        this.setPropertyEmitShapeChanged("end", pnt);
    }

    constructor(options: RayOptions) {
        super({ document: options.document });
        this.setPrivateValue("start", options.start);
        this.setPrivateValue("end", options.end);
    }

    generateShape(): Result<IShape, string> {
        return shapeFactory.line(this.start, this.end);
    }
}
