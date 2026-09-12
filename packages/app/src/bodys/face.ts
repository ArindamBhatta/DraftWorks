import {
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IShape,
    type IWire,
    ParameterShapeNode,
    Result,
    ShapeTypes,
    serializable,
    serialize,
} from "@draftworks/core";

export interface FaceOptions {
    document: IDocument;
    shapes: IEdge[] | IWire[];
}

// 2D-compatible - builds a face from closed edges/wires. Note OCCT faces can lie on
// any surface, not just a plane, so "2D" here means "codimension-1 boundary," not
// strictly flat; still compatible with a 2D drafting build where inputs stay planar.
@serializable()
export class FaceNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.face";
    }

    @serialize()
    get shapes(): IEdge[] | IWire[] {
        return this.getPrivateValue("shapes");
    }
    set shapes(values: IEdge[] | IWire[]) {
        this.setPropertyEmitShapeChanged("shapes", values);
    }

    constructor(options: FaceOptions) {
        super(options);
        this.setPrivateValue("shapes", options.shapes);
    }

    private isAllClosed(): boolean {
        return this.shapes.every((shape) => shape.isClosed() || shape.shapeType === ShapeTypes.wire);
    }

    private getWires(): IWire[] {
        const wires: IWire[] = [];
        if (this.isAllClosed()) {
            this.addClosedEdges(wires);
        } else {
            this.addUnclosedEdges(wires, this.shapes as IEdge[]);
        }

        return wires;
    }

    private addClosedEdges(wires: IWire[]): void {
        for (const shape of this.shapes) {
            if (shape.shapeType === ShapeTypes.wire) {
                wires.push(shape as IWire);
            } else {
                this.addUnclosedEdges(wires, [shape as IEdge]);
            }
        }
    }

    private addUnclosedEdges(wires: IWire[], edges: IEdge[]): void {
        const wire = shapeFactory.wire(edges);
        if (!wire.isOk) throw new Error("Cannot create wire from open shapes");
        wires.push(wire.value);
    }

    override generateShape(): Result<IShape> {
        if (this.shapes.length === 0) return Result.err("No shapes to create face");

        const wires = this.getWires();
        return shapeFactory.face(wires);
    }
}
