//(Core)

import {
    type GeometryFact,
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

import { segmentFacts } from "./line";

export interface ConstructionLineOptions {
    document: IDocument;
    start: XYZ;
    end: XYZ;
}

// A construction line is a straight edge running through `start` and `end`,
// stretched far past both of them by the create.constructionLine command (see
// commands/create/constructionLine.ts) so it reads as "infinite" in both
// directions, the way AutoCAD's XLINE command behaves. The geometry kernel has
// no true infinite-edge primitive, so this is a practical stand-in -
// structurally identical to LineNode (see line.ts), kept as its own class only
// so it serializes/displays as "Construction Line" rather than "Line".
// 2D-compatible - a pure curve (edge), always compatible with a 2D drafting build.

@serializable()
export class ConstructionLineNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.constructionLine";
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

    constructor(options: ConstructionLineOptions) {
        super({ document: options.document });
        this.setPrivateValue("start", options.start);
        this.setPrivateValue("end", options.end);
    }

    override geometryFacts(): GeometryFact[] {
        const world = this.worldTransform();
        return segmentFacts(world.ofPoint(this.start), world.ofPoint(this.end));
    }

    generateShape(): Result<IShape, string> {
        return shapeFactory.line(this.start, this.end);
    }
}
