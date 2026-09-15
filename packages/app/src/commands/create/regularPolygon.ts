import {
    AsyncController,
    Combobox,
    command,
    type GeometryNode,
    type I18nKeys,
    type IStep,
    LengthAtPlaneStep,
    MathUtils,
    Plane,
    PointStep,
    Precision,
    PubSub,
    promptForValue,
    property,
    Result,
    type SnapLengthAtPlaneData,
    type StepOption,
    type XYZ,
} from "@draftworks/core";
import { RegularPolygonNode } from "../../bodys";
import { CreateCommand } from "../createCommand";

/**
 * Which circle the radius measures to - AutoCAD's `[Inscribed in circle/Circumscribed
 * about circle]`.
 *
 * Inscribed puts the polygon's corners on the circle, so the radius is the distance to a
 * vertex; circumscribed puts its sides against the circle, so the radius is the distance
 * to the middle of a side. The same number draws a noticeably different polygon, which is
 * why AutoCAD asks rather than picking one.
 */
export type PolygonFit = "option.polygon.fit.inscribed" | "option.polygon.fit.circumscribed";

export const MinPolygonSides = 3;
export const MaxPolygonSides = 1024;

/**
 * A side count typed at the prompt. Enter alone keeps the remembered one, AutoCAD's
 * `<...>`. Exported for testing.
 */
export function parseSides(text: string, remembered: number): Result<number, I18nKeys> {
    const trimmed = text.trim();
    if (trimmed === "") return Result.ok(remembered);

    // Whole numbers only: there is no polygon with three and a half sides, and parseInt
    // would quietly accept "3.5" as 3 rather than saying so.
    if (!/^\d+$/.test(trimmed)) return Result.err<I18nKeys>("error.polygon.invalidSides");

    const value = Number(trimmed);
    if (value < MinPolygonSides || value > MaxPolygonSides) {
        return Result.err<I18nKeys>("error.polygon.invalidSides");
    }
    return Result.ok(value);
}

/**
 * The distance from the centre to a vertex - what the node is built with.
 *
 * A circumscribed polygon is picked by the middle of its side, which sits closer to the
 * centre than its corners do by cos(pi/n). Dividing that back out is what lets one
 * vertex-radius node draw both fits.
 */
export function vertexRadius(picked: number, sides: number, fit: PolygonFit): number {
    if (fit === "option.polygon.fit.inscribed") return picked;
    return picked / Math.cos(Math.PI / sides);
}

@command({
    key: "create.regularPolygon",
    icon: "icon-polygon",
})
export class RegularPolygon extends CreateCommand {
    /**
     * How many sides - asked first, the way POLYGON asks it, and remembered between runs.
     *
     * This used to be a panel-only setting that the command line never asked about, and
     * its setter wrote somewhere its getter did not read, so typing in the panel changed
     * nothing at all.
     */
    @property("regularPolygon.sides")
    public get sides() {
        return this.getPrivateValue("sides", 6);
    }
    public set sides(value: number) {
        const sides = Math.max(MinPolygonSides, Math.min(MaxPolygonSides, Math.round(value)));
        this.setProperty("sides", sides, () => PubSub.default.pub("refreshStepPrompt"));
    }

    /** Inscribed or circumscribed - the panel's form of the prompt's `[I/C]`. */
    @property("option.polygon.fit", {
        combobox: Combobox.from(["option.polygon.fit.inscribed", "option.polygon.fit.circumscribed"]),
        // The same letters the prompt takes.
        comboboxKeys: ["I", "C"],
    })
    public get fit(): PolygonFit {
        return this.getPrivateValue("fit", "option.polygon.fit.inscribed" as PolygonFit);
    }
    public set fit(value: PolygonFit) {
        this.setProperty("fit", value, () => PubSub.default.pub("refreshStepPrompt"));
    }

    /**
     * POLYGON's opening question, asked before anything is picked: `Enter number of sides
     * <6>:`. It is a typed answer rather than a step, because there is nothing to pick on
     * screen - which is exactly why it has to be asked rather than left in a panel.
     */
    protected override async executeAsync(): Promise<void> {
        this.controller = new AsyncController();
        const sides = await promptForValue<number>({
            controller: this.controller,
            statusTip: "prompt.polygon.sides",
            optionsOnly: false,
            defaultAnswer: String(this.sides),
            parse: (text) => parseSides(text, this.sides),
        });
        if (sides === undefined) return;

        this.sides = sides;
        await super.executeAsync();
    }

    getSteps(): IStep[] {
        const centerStep = new PointStep("prompt.pickCircleCenter");
        const radiusStep = new LengthAtPlaneStep(() => this.radiusTip(), this.getRadiusData);
        return [centerStep, radiusStep];
    }

    /** The radius prompt names the fit it is measuring to, so the two never disagree. */
    private radiusTip(): I18nKeys {
        return this.fit === "option.polygon.fit.circumscribed"
            ? "prompt.polygon.radiusCircumscribed"
            : "prompt.polygon.radiusInscribed";
    }

    /**
     * `Specify radius of circle or [Inscribed/Circumscribed]:` - re-asked on every
     * refresh, so the offer is always the fit the user does not already have.
     */
    private readonly fitOptions = (): StepOption[] => {
        const toCircumscribed = this.fit === "option.polygon.fit.inscribed";
        return [
            {
                key: toCircumscribed ? "C" : "I",
                name: toCircumscribed ? "prompt.optionName.circumscribed" : "prompt.optionName.inscribed",
                display: toCircumscribed ? "prompt.option.circumscribed" : "prompt.option.inscribed",
                onSelect: () => {
                    this.fit = toCircumscribed
                        ? "option.polygon.fit.circumscribed"
                        : "option.polygon.fit.inscribed";
                },
            },
        ];
    };

    private readonly getRadiusData = (): SnapLengthAtPlaneData => {
        const { point, view } = this.stepDatas[0];
        return {
            point: () => point!,
            preview: this.polygonPreview,
            plane: (tmp: XYZ | undefined) => this.findPlane(view, point!, tmp),
            options: this.fitOptions(),
            validator: (p: XYZ) => {
                if (p.distanceTo(point!) < Precision.Distance) return false;
                const plane = this.findPlane(view, point!, p);
                return p.sub(point!).isParallelTo(plane.normal) === false;
            },
        };
    };

    /**
     * The polygon as picked - its vertex radius, and the direction its first vertex
     * points in.
     *
     * calculateVertices puts a vertex on the x-axis it is given, which is the pick
     * direction. That is right for an inscribed polygon, where the pick is a corner, and
     * wrong for a circumscribed one, where the pick is the middle of a side - so the
     * frame is turned half a step to put the side there instead.
     */
    private pickedPolygon(center: XYZ, picked: XYZ) {
        const plane = this.getPlane(center, picked);
        const distance = plane.projectDistance(center, picked);
        const circumscribed = this.fit === "option.polygon.fit.circumscribed";

        const xvec = circumscribed ? plane.xvec.rotate(plane.normal, Math.PI / this.sides)! : plane.xvec;

        return {
            normal: plane.normal,
            xvec,
            radius: vertexRadius(distance, this.sides, this.fit),
        };
    }

    protected override geometryNode(): GeometryNode {
        const [p1, p2] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        const { normal, xvec, radius } = this.pickedPolygon(p1, p2);
        return new RegularPolygonNode({
            document: this.document,
            normal,
            xvec,
            center: p1,
            radius,
            sides: this.sides,
        });
    }

    private readonly polygonPreview = (end: XYZ | undefined) => {
        if (!end) return [this.meshPoint(this.stepDatas[0].point!)];

        const { point } = this.stepDatas[0];
        const { normal, xvec, radius } = this.pickedPolygon(point!, end);
        if (MathUtils.allEqualZero(radius)) return [this.meshPoint(point!)];

        const vertices = RegularPolygonNode.calculateVertices(point!, radius, this.sides, normal, xvec);

        const meshes: ReturnType<typeof this.meshLine>[] = [];
        for (let i = 0; i < vertices.length - 1; i++) {
            meshes.push(this.meshLine(vertices[i], vertices[i + 1]));
        }

        return [this.meshPoint(this.stepDatas[0].point!), this.meshLine(point!, end), ...meshes];
    };

    protected getPlane(p1: XYZ, p2: XYZ) {
        const plane = this.findPlane(this.stepDatas[0].view, p1, p2);
        const radiusVec = p2.sub(p1);
        const yvec = plane.normal.cross(radiusVec).normalize()!;
        const xvec = yvec.cross(plane.normal).normalize()!;
        return new Plane({
            origin: p1,
            xvec: xvec,
            normal: plane.normal,
        });
    }
}
