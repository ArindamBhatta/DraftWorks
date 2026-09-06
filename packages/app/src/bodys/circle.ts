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
} from "@chili3d/core";

export interface CircleOptions {
    document: IDocument;
    normal: XYZ;
    center: XYZ;
    radius: number;
}

// CircleNode extends FacebaseNode (not ParameterShapeNode directly) because a circle
// is a planar curve that can optionally be capped into a face - see generateShape()
// below and core/src/model/facebaseNode.ts for why that toggle lives one layer up
// rather than here. This body has no 2D-vs-3D ambiguity to flag: it's inherently
// planar and is one of the bodies a 2D-only build of this app would keep.
@serializable()
export class CircleNode extends FacebaseNode {
    override display(): I18nKeys {
        return "body.circle";
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
    @property("circle.radius")
    get radius() {
        return this.getPrivateValue("radius");
    }
    set radius(radius: number) {
        this.setPropertyEmitShapeChanged("radius", radius);
    }

    @serialize()
    get normal(): XYZ {
        return this.getPrivateValue("normal");
    }

    constructor(options: CircleOptions) {
        super({ document: options.document });
        this.setPrivateValue("normal", options.normal);
        this.setPrivateValue("center", options.center);
        this.setPrivateValue("radius", options.radius);
    }

    // Always builds the bare circular edge first; only wraps it into a wire and caps
    // it to a face (.toFace()) when isFace is true. This is the concrete branch that
    // FacebaseNode.isFace (see core/src/model/facebaseNode.ts) controls - the same
    // shapeFactory.circle() call underlies both a wireframe circle (isFace: false,
    // renders as a line loop) and a filled disc (isFace: true, renders as a
    // tessellated face).
    generateShape(): Result<IShape, string> {
        const circle = shapeFactory.circle(this.normal, this.center, this.radius);
        if (!circle.isOk || !this.isFace) return circle;
        const wire = shapeFactory.wire([circle.value]);
        return wire.isOk ? wire.value.toFace() : circle;
    }
}
