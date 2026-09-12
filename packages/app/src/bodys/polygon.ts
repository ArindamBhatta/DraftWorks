import {
    FacebaseNode,
    type I18nKeys,
    type IDocument,
    type IShape,
    property,
    type Result,
    serializable,
    serialize,
    type XYZ,
} from "@draftworks/core";

export interface PolygonOptions {
    document: IDocument;
    points: XYZ[];
}

// 2D-compatible - planar, face-optional via FacebaseNode.isFace (see circle.ts for
// the fuller rationale).
@serializable()
export class PolygonNode extends FacebaseNode {
    override display(): I18nKeys {
        return "body.polygon";
    }

    @serialize()
    @property("polygon.points")
    get points() {
        return this.getPrivateValue("points");
    }
    set points(value: XYZ[]) {
        this.setPropertyEmitShapeChanged("points", value);
    }

    constructor(options: PolygonOptions) {
        super({ document: options.document });
        this.setPrivateValue("points", options.points);
    }

    generateShape(): Result<IShape, string> {
        const wire = shapeFactory.polygon(this.points);
        if (!wire.isOk || !this.isFace) return wire;
        return wire.value.toFace();
    }
}
