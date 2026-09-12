// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    buildDimensionGeometry,
    DimensionAnnotation,
    type DimensionAnnotationOptions,
    type DimensionFrame,
    type DimensionType,
    MeshDataUtils,
    MultiStepCommand,
    type ShapeMeshData,
    Transaction,
    VisualConfig,
    XYZ,
} from "@draftworks/core";

/**
 * Shared behaviour for the DIM* commands: while the dimension line is being dragged
 * they preview the finished dimension - line work and arrowheads, not just a rubber
 * band - and on confirm they add one DimensionAnnotation to the drawing.
 *
 * Subclasses supply the picked points via `dimensionInput`; everything from there
 * (layout, arrowheads, formatting) comes from buildDimensionGeometry, so the preview
 * and the committed object can never disagree.
 */
export abstract class DimensionCommandBase extends MultiStepCommand {
    /**
     * A getter rather than a field so a command can decide the kind from what was
     * picked - see ObjectDimension, which dimensions a circle radially and a line
     * linearly. Read on every preview frame, so keep it cheap.
     */
    protected abstract get dimensionType(): DimensionType;

    /** The picked geometry, or undefined while not enough points are known yet. */
    protected abstract dimensionInput(offsetPoint: XYZ):
        | {
              start: XYZ;
              end: XYZ;
              third?: XYZ;
              radius?: number;
          }
        | undefined;

    /** The drawing plane the dimension is laid out in. */
    protected frame(): DimensionFrame {
        const workplane = this.stepDatas[0].view.workplane;
        return { normal: workplane.normal, xAxis: workplane.xvec };
    }

    /**
     * Turns the dimension's line work into preview meshes. Arrow triangles are outlined
     * rather than filled - the preview pipeline only carries line and point meshes - so
     * the head reads as an arrow while dragging and fills in once committed.
     */
    protected previewDimension(offsetPoint: XYZ | undefined): ShapeMeshData[] {
        if (!offsetPoint) return [];
        const input = this.dimensionInput(offsetPoint);
        if (!input) return [];

        const geometry = buildDimensionGeometry({
            type: this.dimensionType,
            ...input,
            offsetPoint,
            frame: this.frame(),
        });
        if (!geometry) return [];

        const color = VisualConfig.highlightEdgeColor;
        const meshes: ShapeMeshData[] = [];

        for (let i = 0; i + 5 < geometry.lines.length; i += 6) {
            meshes.push(this.meshLineFromFlat(geometry.lines, i, color));
        }
        for (let i = 0; i + 8 < geometry.arrows.length; i += 9) {
            meshes.push(...this.meshTriangleOutline(geometry.arrows, i, color));
        }
        return meshes;
    }

    private meshLineFromFlat(values: number[], offset: number, color: number) {
        return MeshDataUtils.createEdgeMesh(
            this.pointAt(values, offset),
            this.pointAt(values, offset + 3),
            color,
            "solid",
        );
    }

    private meshTriangleOutline(values: number[], offset: number, color: number) {
        const a = this.pointAt(values, offset);
        const b = this.pointAt(values, offset + 3);
        const c = this.pointAt(values, offset + 6);
        return [
            MeshDataUtils.createEdgeMesh(a, b, color, "solid"),
            MeshDataUtils.createEdgeMesh(b, c, color, "solid"),
            MeshDataUtils.createEdgeMesh(c, a, color, "solid"),
        ];
    }

    private pointAt(values: number[], offset: number): XYZ {
        return new XYZ({ x: values[offset], y: values[offset + 1], z: values[offset + 2] });
    }

    protected override executeMainTask(): void {
        const offsetPoint = this.stepDatas.at(-1)?.point;
        if (!offsetPoint) return;

        const input = this.dimensionInput(offsetPoint);
        if (!input) return;

        const frame = this.frame();
        const options: DimensionAnnotationOptions = {
            document: this.document,
            name: this.dimensionType,
            annotationType: "dimension",
            dimensionType: this.dimensionType,
            startPoint: input.start,
            endPoint: input.end,
            thirdPoint: input.third,
            offsetPoint,
            radius: input.radius,
            normal: frame.normal,
            xAxis: frame.xAxis,
        };

        Transaction.execute(this.document, `create ${this.dimensionType} dimension`, () => {
            this.document.modelManager.addNode(new DimensionAnnotation(options));
            this.document.visual.update();
        });
        this.repeatOperation = true;
    }
}
