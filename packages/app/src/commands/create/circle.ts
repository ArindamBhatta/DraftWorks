import {
    Combobox,
    command,
    Dimensions,
    type GeometryNode,
    type I18nKeys,
    type IStep,
    LengthAtPlaneStep,
    type Plane,
    type PointSnapData,
    PointStep,
    Precision,
    PubSub,
    property,
    type SnapLengthAtPlaneData,
    type StepOption,
    XYZ,
} from "@chili3d/core";
import { CircleNode } from "../../bodys";
import { CreateFaceableCommand } from "../createCommand";

type CircleMode =
    | "option.command.circleMode.center"
    | "option.command.circleMode.twoPoint"
    | "option.command.circleMode.threePoint";

type CircleSizeMode = "option.command.circleSizeMode.radius" | "option.command.circleSizeMode.diameter";

/**
 * The circle through three points, worked out in `plane`'s own 2D coordinates - this
 * is a 2D drafting view, so every pick already lies on the one workplane (see
 * findPlane in multistepCommand.ts) - via the standard circumcenter formula.
 * Undefined when the points are collinear (including two of them coinciding), the
 * one case with no solution. A free function (rather than a method) so it can be
 * tested without a live command/document. Exported for testing.
 */
export function circumcircle(
    p1: XYZ,
    p2: XYZ,
    p3: XYZ,
    plane: Plane,
): { center: XYZ; radius: number } | undefined {
    const to2d = (p: XYZ) => {
        const v = p.sub(plane.origin);
        return { x: v.dot(plane.xvec), y: v.dot(plane.yvec) };
    };
    const [a, b, c] = [to2d(p1), to2d(p2), to2d(p3)];

    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < Precision.Distance) return undefined;

    const aSq = a.x * a.x + a.y * a.y;
    const bSq = b.x * b.x + b.y * b.y;
    const cSq = c.x * c.x + c.y * c.y;
    const ux = (aSq * (b.y - c.y) + bSq * (c.y - a.y) + cSq * (a.y - b.y)) / d;
    const uy = (aSq * (c.x - b.x) + bSq * (a.x - c.x) + cSq * (b.x - a.x)) / d;

    const center = plane.origin.add(plane.xvec.multiply(ux)).add(plane.yvec.multiply(uy));
    return { center, radius: center.distanceTo(p1) };
}

/**
 * AutoCAD's CIRCLE offers Center (Radius or Diameter), 2P and 3P as its everyday
 * methods - Ttr (tangent, tangent, radius) is a separate, harder tangent-circle
 * solve and isn't implemented here. All three are picked by clicking through
 * points/lengths the same way every other create command in this app works;
 * `mode` and `sizeMode` are exposed as dropdowns in the command's property panel,
 * the one place every command already surfaces its options (see modify/array.ts's
 * patternType, or create/offset.ts's joinType) - and switching `mode` restarts the
 * step sequence the same way ArrayCommand.patternType does.
 */
@command({
    key: "create.circle",
    icon: "icon-circle",
})
export class Circle extends CreateFaceableCommand {
    @property("option.command.circleMode", {
        combobox: Combobox.from([
            "option.command.circleMode.center",
            "option.command.circleMode.twoPoint",
            "option.command.circleMode.threePoint",
        ]),
    })
    get mode(): CircleMode {
        return this.getPrivateValue("mode", "option.command.circleMode.center" as CircleMode);
    }
    set mode(value: CircleMode) {
        this.setProperty("mode", value, () => this.restart());
    }

    @property("option.command.circleSizeMode", {
        combobox: Combobox.from([
            "option.command.circleSizeMode.radius",
            "option.command.circleSizeMode.diameter",
        ]),
        dependencies: [{ property: "mode", value: "option.command.circleMode.center" }],
    })
    get sizeMode(): CircleSizeMode {
        return this.getPrivateValue("sizeMode", "option.command.circleSizeMode.radius" as CircleSizeMode);
    }
    set sizeMode(value: CircleSizeMode) {
        // No restart: the centre is already picked and AutoCAD keeps it - flipping
        // this only changes how the length about to be picked is read. The live
        // prompt re-reads itself instead, so the wording and the `[Diameter]`/
        // `[Radius]` option follow along wherever the change came from.
        this.setProperty("sizeMode", value, () => PubSub.default.pub("refreshStepPrompt"));
    }

    getSteps(): IStep[] {
        switch (this.mode) {
            case "option.command.circleMode.twoPoint":
                return [
                    new PointStep("prompt.circle.firstDiameterPoint", this.getFirstPointData),
                    new PointStep("prompt.circle.secondDiameterPoint", this.getTwoPointSecondData),
                ];
            case "option.command.circleMode.threePoint":
                return [
                    new PointStep("prompt.circle.firstPoint", this.getFirstPointData),
                    new PointStep("prompt.circle.secondPoint", this.getThreePointSecondData),
                    new PointStep("prompt.circle.thirdPoint", this.getThreePointThirdData),
                ];
            default:
                return [
                    new PointStep("prompt.circle.centerPoint", this.getFirstPointData),
                    // A function, not a value: the wording flips with sizeMode, which
                    // the user can change while this very prompt is up.
                    new LengthAtPlaneStep(() => this.sizeTip(), this.getRadiusData),
                ];
        }
    }

    // ------------------------------------------------------- prompt options

    /**
     * The first prompt of every mode offers the others, AutoCAD-style:
     * `CIRCLE Specify center point for circle or [3P/2P]:`. Switching restarts the
     * command with the new step sequence - the same setter the ribbon's property
     * panel drives, so typing `3P`, clicking `3P` and choosing it from the panel are
     * three ways into one pipeline.
     */
    private readonly getFirstPointData = (): PointSnapData => ({
        dimension: Dimensions.D1D2D3,
        options: () =>
            (
                [
                    ["3P", "option.command.circleMode.threePoint", "prompt.option.threePoint"],
                    ["2P", "option.command.circleMode.twoPoint", "prompt.option.twoPoint"],
                    ["C", "option.command.circleMode.center", "prompt.option.center"],
                ] as const
            )
                .filter(([, mode]) => mode !== this.mode)
                .map(([key, mode, display]) => ({
                    key,
                    display,
                    onSelect: () => {
                        this.mode = mode;
                    },
                })),
    });

    private sizeTip(): I18nKeys {
        return this.sizeMode === "option.command.circleSizeMode.diameter"
            ? "prompt.circle.diameter"
            : "prompt.circle.radius";
    }

    /**
     * `Specify radius of circle or [Diameter]:` - and the other way round once
     * Diameter is chosen. Re-asked on every refresh rather than captured once, so
     * the offer is always the one the user does not already have.
     */
    private readonly sizeOptions = (): StepOption[] => {
        const toDiameter = this.sizeMode === "option.command.circleSizeMode.radius";
        return [
            {
                key: toDiameter ? "D" : "R",
                display: toDiameter ? "prompt.option.diameter" : "prompt.option.radius",
                onSelect: () => {
                    this.sizeMode = toDiameter
                        ? "option.command.circleSizeMode.diameter"
                        : "option.command.circleSizeMode.radius";
                },
            },
        ];
    };

    protected override geometryNode(): GeometryNode {
        const body = new CircleNode(this.buildCircleData());
        body.isFace = this.isFace;
        return body;
    }

    // ------------------------------------------------------------ Center mode

    private readonly getRadiusData = (): SnapLengthAtPlaneData => {
        const { point, view } = this.stepDatas[0];
        return {
            point: () => point!,
            preview: this.centerPreview,
            plane: (tmp: XYZ | undefined) => this.findPlane(view, point!, tmp),
            options: this.sizeOptions(),
            validator: (p: XYZ) => {
                if (p.distanceTo(point!) < Precision.Distance) return false;
                const plane = this.findPlane(view, point!, p);
                return p.sub(point!).isParallelTo(plane.normal) === false;
            },
        };
    };

    private readonly centerPreview = (end: XYZ | undefined) => {
        if (!end) return [this.meshPoint(this.stepDatas[0].point!)];

        const { point, view } = this.stepDatas[0];
        const plane = this.findPlane(view, point!, end);
        return [
            this.meshPoint(point!),
            this.meshLine(point!, end),
            this.meshCreatedShape(
                "circle",
                plane.normal,
                point!,
                this.pickedToRadius(plane.projectDistance(point!, end)),
            ),
        ];
    };

    /** A picked length is the diameter when sizeMode says so - halve it to get the radius the kernel needs. */
    private pickedToRadius(pickedDistance: number): number {
        return this.sizeMode === "option.command.circleSizeMode.diameter"
            ? pickedDistance / 2
            : pickedDistance;
    }

    // --------------------------------------------------------------- 2P mode

    private readonly getTwoPointSecondData = (): PointSnapData => {
        const first = this.stepDatas[0].point!;
        return {
            refPoint: () => first,
            dimension: Dimensions.D1D2D3,
            preview: (end: XYZ | undefined) => this.twoPointPreview(first, end),
        };
    };

    private twoPointPreview(first: XYZ, end: XYZ | undefined) {
        if (!end) return [this.meshPoint(first)];

        const plane = this.findPlane(this.stepDatas[0].view, first, end);
        return [
            this.meshPoint(first),
            this.meshPoint(end),
            this.meshLine(first, end),
            this.meshCreatedShape("circle", plane.normal, XYZ.center(first, end), first.distanceTo(end) / 2),
        ];
    }

    // --------------------------------------------------------------- 3P mode

    private readonly getThreePointSecondData = (): PointSnapData => {
        const first = this.stepDatas[0].point!;
        return {
            refPoint: () => first,
            dimension: Dimensions.D1D2D3,
            preview: (end: XYZ | undefined) =>
                end
                    ? [this.meshPoint(first), this.meshPoint(end), this.meshLine(first, end)]
                    : [this.meshPoint(first)],
        };
    };

    private readonly getThreePointThirdData = (): PointSnapData => {
        const [first, second] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        return {
            refPoint: () => second,
            dimension: Dimensions.D1D2D3,
            preview: (end: XYZ | undefined) => this.threePointPreview(first, second, end),
            // A third point collinear with (or coincident with either of) the first two
            // has no circumcircle - circumcircle() returns undefined for it, which is
            // exactly what should block confirming that pick.
            validator: (p: XYZ) =>
                circumcircle(first, second, p, this.findPlane(this.stepDatas[0].view, first, undefined)) !==
                undefined,
        };
    };

    private threePointPreview(first: XYZ, second: XYZ, third: XYZ | undefined) {
        const points = [this.meshPoint(first), this.meshPoint(second)];
        if (!third) return points;
        points.push(this.meshPoint(third));

        const plane = this.findPlane(this.stepDatas[0].view, first, undefined);
        const circle = circumcircle(first, second, third, plane);
        if (!circle) return points;

        return [...points, this.meshCreatedShape("circle", plane.normal, circle.center, circle.radius)];
    }

    // ---------------------------------------------------------------- build

    private buildCircleData() {
        const document = this.document;

        if (this.mode === "option.command.circleMode.twoPoint") {
            const [p1, p2] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
            const plane = this.findPlane(this.stepDatas[0].view, p1, p2);
            return {
                document,
                normal: plane.normal,
                center: XYZ.center(p1, p2),
                radius: p1.distanceTo(p2) / 2,
            };
        }

        if (this.mode === "option.command.circleMode.threePoint") {
            const [p1, p2, p3] = [
                this.stepDatas[0].point!,
                this.stepDatas[1].point!,
                this.stepDatas[2].point!,
            ];
            const plane = this.findPlane(this.stepDatas[0].view, p1, undefined);
            // The third point's validator already rejected anything circumcircle()
            // can't solve, so this pick is guaranteed to have a solution here.
            const circle = circumcircle(p1, p2, p3, plane)!;
            return { document, normal: plane.normal, center: circle.center, radius: circle.radius };
        }

        const [p1, p2] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        const plane = this.stepDatas[1].plane ?? this.findPlane(this.stepDatas[1].view, p1, p2);
        return {
            document,
            normal: plane.normal,
            center: p1,
            radius: this.pickedToRadius(plane.projectDistance(p1, p2)),
        };
    }
}
