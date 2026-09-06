//ink on the paper. arc itself  just four numbers: center, start, angle, normal. This is what gets saved into your file,

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

export interface ArcOptions {
    document: IDocument;
    normal: XYZ;
    center: XYZ;
    start: XYZ;
    angle: number;
}

// 2D-compatible - a pure curve (edge), always compatible with a 2D drafting build.
@serializable()
export class ArcNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.arc";
    }

    @serialize()
    @property("circle.center")
    get center() {
        return this.getPrivateValue("center");
    }
    set center(center: XYZ) {
        this.setPropertyEmitShapeChanged("center", center);
    }

    @serialize()
    @property("arc.start")
    get start(): XYZ {
        return this.getPrivateValue("start");
    }

    @serialize()
    get normal(): XYZ {
        return this.getPrivateValue("normal");
    }

    @serialize()
    @property("arc.angle")
    get angle() {
        return this.getPrivateValue("angle");
    }
    set angle(value: number) {
        this.setPropertyEmitShapeChanged("angle", value);
    }

    constructor(options: ArcOptions) {
        super({ document: options.document });
        this.setPrivateValue("normal", options.normal);
        this.setPrivateValue("center", options.center);
        this.setPrivateValue("start", options.start);
        this.setPrivateValue("angle", options.angle);
    }

    generateShape(): Result<IShape, string> {
        return shapeFactory.arc(this.normal, this.center, this.start, this.angle);
    }
}
