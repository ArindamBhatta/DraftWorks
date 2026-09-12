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

export interface LineOptions {
    document: IDocument;
    start: XYZ;
    end: XYZ;
}

// 2D-compatible - a pure curve (edge), always compatible with a 2D drafting build.
// Not a FacebaseNode since a line can never become a face.
@serializable()
export class LineNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.line";
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

    constructor(options: LineOptions) {
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

/**
 * The read-only Geometry rows AutoCAD shows under a line's Start and End: how far the
 * end is from the start along each axis, the straight-line distance, and the bearing in
 * the XY plane. Shared with ConstructionLineNode, which is the same two points drawn differently.
 *
 * The angle is measured the way AutoCAD reports it - degrees counter-clockwise from the
 * positive X axis, normalised into 0-360 rather than atan2's -180..180, so a line drawn
 * down-and-left reads 225 and not -135.
 */
export function segmentFacts(start: XYZ, end: XYZ): GeometryFact[] {
    const delta = end.sub(start);
    const angle = ((Math.atan2(delta.y, delta.x) * 180) / Math.PI + 360) % 360;
    return [
        { display: "geometry.deltaX", value: delta.x, kind: "length" },
        { display: "geometry.deltaY", value: delta.y, kind: "length" },
        { display: "geometry.deltaZ", value: delta.z, kind: "length" },
        { display: "common.length", value: delta.length(), kind: "length" },
        { display: "common.angle", value: angle, kind: "angle" },
    ];
}
