//(Core of arg)
// ink on the paper. arc itself  just four numbers: center, start, angle, normal. This is what gets saved into your file,

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
} from "@draftworks/core";

export interface ArcOptions {
    document: IDocument;
    normal: XYZ;
    center: XYZ;
    start: XYZ;
    angle: number;
}

// ArcNode is Node of the document tree. it stores the document tree. it stores four values(center, start, angle, normal) each marked @serializable() so it round tips to file. and each marked @property() so it shows up in the property panel. it hs no idea for mouse exists.
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
    // Radius and arc length are not stored - they fall out of the four numbers above -
    // so the palette reports them rather than offering them to type into, matching
    // AutoCAD, where an arc's Radius follows from where its endpoints are.
    override geometryFacts(): GeometryFact[] {
        const world = this.worldTransform();
        const radius = world.ofPoint(this.start).distanceTo(world.ofPoint(this.center));
        return [
            { display: "circle.radius", value: radius, kind: "length" },
            // `angle` is stored in degrees (see PlaneAngle), arc length needs radians.
            {
                display: "common.length",
                value: (radius * Math.abs(this.angle) * Math.PI) / 180,
                kind: "length",
            },
        ];
    }

    //turn those four numbers into an OCCT shape via shapeFactory.arc.
    generateShape(): Result<IShape, string> {
        return shapeFactory.arc(this.normal, this.center, this.start, this.angle);
    }
}
