// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CancelableCommand,
    Combobox,
    command,
    DimensionSetup,
    type I18nKeys,
    type IDisposable,
    type IEdge,
    type IFace,
    Localize,
    type Matrix4,
    property,
    SelectShapeStep,
    type ShapeType,
    ShapeTypes,
    VisualConfig,
    type VisualShapeData,
} from "@chili3d/core";
import { div, h1, h2, span, ul } from "@chili3d/element";
import style from "./select.module.css";

// Length and area only - solid volume went with the rest of the 3D feature set.
type MeasureType = "common.length" | "common.area";

@command({
    key: "measure.select",
    icon: "icon-measureSelect",
})
export class SelectMeasure extends CancelableCommand {
    #isChangedType = false;
    #sum = 0;
    #sumUI?: {
        container: HTMLDivElement;
        header: HTMLHeadingElement;
        list: HTMLUListElement;
        value: HTMLSpanElement;
    };
    readonly #disposeSet: Set<IDisposable> = new Set();

    @property("common.type", {
        combobox: Combobox.from(["common.length", "common.area"]),
    })
    public get category() {
        return this.getPrivateValue("category", "common.length");
    }
    public set category(value: MeasureType) {
        this.setProperty("category", value, () => this.onTypeChange());
    }

    private readonly onTypeChange = () => {
        this.#isChangedType = true;
        this.controller?.cancel();
        this.#sumUI?.container.remove();
        this.#sumUI = undefined;
        this.#disposeSet.forEach((d) => d.dispose());
        this.#disposeSet.clear();
        this.#sum = 0;
    };

    private initSumUI() {
        if (this.#sumUI) {
            this.#sumUI.container.remove();
        }
        this.#sumUI = {
            container: div({
                className: style.selectSum,
            }),
            header: h1({ textContent: new Localize(this.category) }),
            list: ul(),
            value: span({
                textContent: "0.00",
            }),
        };
        this.#sumUI.container.append(this.#sumUI.header, this.#sumUI.list, h2(this.#sumUI.value));

        this.application.activeView?.dom?.append(this.#sumUI.container);
    }

    /** Areas are plain numbers; lengths follow the drawing's unit format. */
    private formatValue(value: number) {
        return this.category === "common.length"
            ? DimensionSetup.formatLength(value)
            : DimensionSetup.formatDecimal(value);
    }

    private addSumItem(item: number) {
        this.#sum += item;
        if (!this.#sumUI) {
            this.initSumUI();
        }

        const li = document.createElement("li");
        li.textContent = this.formatValue(item);
        this.#sumUI!.list.append(li);
        this.#sumUI!.value.textContent = this.formatValue(this.#sum);
    }

    protected override afterExecute(): void {
        super.afterExecute();
        this.#disposeSet.forEach((d) => d.dispose());
        this.#disposeSet.clear();
        this.#sumUI?.container.remove();
    }

    protected override async executeAsync(): Promise<void> {
        while (true) {
            this.controller = new AsyncController();
            let type: [ShapeType, I18nKeys] = [ShapeTypes.edge, "prompt.select.edges"];
            if (this.category === "common.area") {
                type = [ShapeTypes.face, "prompt.select.faces"];
            }

            const step = new SelectShapeStep(type[0], type[1]);
            const result = await step.execute(this.document, this.controller);
            if (this.controller.result?.status !== "success") {
                if (this.#isChangedType) {
                    this.#isChangedType = false;
                    continue;
                } else {
                    return;
                }
            }
            this.createMeasure(result?.shapes[0]);
        }
    }

    private readonly createMeasure = (shape: VisualShapeData | undefined) => {
        if (!shape) return;
        if (this.category === "common.length") {
            this.edgeMeasure(shape.shape as IEdge, shape.transform);
        } else if (this.category === "common.area") {
            this.faceMeasure(shape.shape as IFace, shape.transform);
        }
    };

    private edgeMeasure(edge: IEdge, transform: Matrix4) {
        edge = edge.transformedMul(transform) as IEdge;
        const start = edge.curve.startPoint();
        const end = edge.curve.endPoint();
        const length = edge.length();
        this.addSumItem(length);
        const mesh = edge.mesh.edges!;
        edge.dispose();
        mesh.lineWidth = 3;
        mesh.color = VisualConfig.highlightEdgeColor;

        const id = this.document.visual.context.displayMesh([mesh]);
        this.#disposeSet.add(
            this.application.activeView!.htmlText(
                DimensionSetup.formatLength(length),
                start.add(end).multiply(0.5),
                {
                    hideDelete: true,
                    onDispose: () => {
                        this.document.visual.context.removeMesh(id);
                    },
                },
            ),
        );
    }

    private faceMeasure(face: IFace, transform: Matrix4) {
        const wire = face.outerWire();
        const mesh = wire.mesh.edges!;
        wire.dispose();
        mesh.lineWidth = 3;
        mesh.color = VisualConfig.highlightEdgeColor;
        mesh.position = new Float32Array(transform.ofPoints(mesh.position));

        const area = face.area();
        this.addSumItem(area);
        const center = this.wireCenter(mesh.position);
        const id = this.document.visual.context.displayMesh([mesh]);
        this.#disposeSet.add(
            this.application.activeView!.htmlText(DimensionSetup.formatDecimal(area), center, {
                hideDelete: true,
                onDispose: () => {
                    this.document.visual.context.removeMesh(id);
                },
            }),
        );
    }

    private wireCenter(points: ArrayLike<number>) {
        const center = { x: 0, y: 0, z: 0 };
        for (let i = 0; i < points.length; i += 3) {
            center.x += points[i];
            center.y += points[i + 1];
            center.z += points[i + 2];
        }

        const length = points.length / 3;
        center.x /= length;
        center.y /= length;
        center.z /= length;
        return center;
    }
}
