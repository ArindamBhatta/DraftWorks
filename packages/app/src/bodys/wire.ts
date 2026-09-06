import {
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IShape,
    ParameterShapeNode,
    type Result,
    serializable,
    serialize,
} from "@chili3d/core";

export interface WireOptions {
    document: IDocument;
    edges: IEdge[];
}

// 2D-compatible - joins edges into a wire (curve chain), compatible with a 2D
// drafting build.
@serializable()
export class WireNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.wire";
    }

    @serialize()
    get edges(): IEdge[] {
        return this.getPrivateValue("edges");
    }
    set edges(values: IEdge[]) {
        this.setPropertyEmitShapeChanged("edges", values);
    }

    constructor(options: WireOptions) {
        super(options);
        this.setPrivateValue("edges", options.edges);
    }

    override generateShape(): Result<IShape> {
        return shapeFactory.wire(this.edges);
    }
}
