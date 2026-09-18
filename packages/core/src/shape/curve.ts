import { type Line, MathUtils, type XYZ } from "../math";
import type { IGeometry } from "./geometry";

export type CurveType =
    | "line"
    | "circle"
    | "ellipse"
    | "hyperbola"
    | "parabola"
    | "bezierCurve"
    | "bsplineCurve"
    | "offsetCurve"
    | "otherCurve"
    | "trimmedCurve";

export const Continuities = ["c0", "g1", "c1", "g2", "c2", "c3", "cn"] as const;
export type Continuity = (typeof Continuities)[number];

export interface ICurve extends IGeometry {
    get curveType(): CurveType;
    uniformAbscissaByLength(length: number): XYZ[];
    uniformAbscissaByCount(curveCount: number): XYZ[];
    length(): number;
    parameter(point: XYZ, tolerance: number): number | undefined;
    firstParameter(): number;
    lastParameter(): number;
    project(point: XYZ): XYZ[];
    value(parameter: number): XYZ;
    isCN(n: number): boolean;
    trim(u1: number, u2: number): ITrimmedCurve;
    d0(u: number): XYZ;
    d1(u: number): { point: XYZ; vec: XYZ };
    d2(u: number): { point: XYZ; vec1: XYZ; vec2: XYZ };
    d3(u: number): { point: XYZ; vec1: XYZ; vec2: XYZ; vec3: XYZ };
    dn(u: number, n: number): XYZ;
    reverse(): void;
    reversed(): ICurve;
    nearestFromPoint(point: XYZ): {
        point: XYZ;
        parameter: number;
        distance: number;
    };
    nearestExtrema(curve: ICurve | Line):
        | undefined
        | {
              isParallel: boolean;
              distance: number;
              p1: XYZ;
              p2: XYZ;
              u1: number;
              u2: number;
          };
    isClosed(): boolean;
    period(): number;
    isPeriodic(): boolean;
    continuity(): Continuity;
}

export interface ILine extends ICurve {
    direction: XYZ;
}

export interface IConic extends ICurve {
    axis: XYZ;
    xAxis: XYZ;
    yAxis: XYZ;
    eccentricity(): number;
}

export interface ICircle extends IConic {
    center: XYZ;
    radius: number;
}

export interface IEllipse extends IConic {
    center: XYZ;
    get focus1(): XYZ;
    get focus2(): XYZ;
    majorRadius: number;
    minorRadius: number;
}

export interface IHyperbola extends IConic {
    focal(): number;
    location: XYZ;
    get focus1(): XYZ;
    get focus2(): XYZ;
    majorRadius: number;
    minorRadius: number;
}

export interface IParabola extends IConic {
    focal(): number;
    get focus(): XYZ;
    get directrix(): XYZ;
}

export interface IBoundedCurve extends ICurve {
    startPoint(): XYZ;
    endPoint(): XYZ;
}

export interface IBezierCurve extends IBoundedCurve {
    degree(): number;
    weight(index: number): number;
    insertPoleAfter(index: number, point: XYZ, weight?: number): void;
    insertPoleBefore(index: number, point: XYZ, weight?: number): void;
    removePole(index: number): void;
    setPole(index: number, point: XYZ, weight?: number): void;
    setWeight(index: number, weight: number): void;
    nbPoles(): number;
    pole(index: number): XYZ;
    poles(): XYZ[];
}

export interface IBSplineCurve extends IBoundedCurve {
    degree(): number;
    nbKnots(): number;
    knot(index: number): number;
    setKnot(index: number, value: number): void;
    nbPoles(): number;
    pole(index: number): XYZ;
    poles(): XYZ[];
    weight(index: number): number;
    setWeight(index: number, value: number): void;
}

export interface ITrimmedCurve extends IBoundedCurve {
    get basisCurve(): ICurve;
    setTrim(u1: number, u2: number): void;
}

export interface IOffsetCurve extends ICurve {
    get basisCurve(): ICurve;
    offset(): number;
    direction(): XYZ;
}

export interface IComplexCurve {
    nbCurves(): number;
    curve(index: number): ICurve;
}

export class CurveUtils {
    static isConic(curve: ICurve): curve is IConic {
        return (curve as IConic).axis !== undefined;
    }

    static isCircle(curve: ICurve): curve is ICircle {
        const circle = curve as ICircle;
        return circle.center !== undefined && circle.radius !== undefined;
    }

    /**
     * Whether this curve is an ILine - a line primitive, whose `direction` is a vector.
     *
     * The test is that `direction` is a vector rather than merely present, because an
     * offset curve exposes a `direction()` *method*: a bare "is it defined" check
     * accepted one and handed the caller a function where it expected an XYZ, which then
     * failed in whatever used it as a vector, a long way from here.
     *
     * Note this asks what the curve *is*, not whether it runs straight. An offset of a
     * line is straight and is not an ILine, so a caller that only needs straightness
     * should measure it instead - see straightDirection in the fillet command.
     */
    static isLine(curve: ICurve): curve is ILine {
        const direction = (curve as ILine).direction;
        return direction !== undefined && typeof direction !== "function";
    }

    static isTrimmed(curve: ICurve): curve is ITrimmedCurve {
        return (curve as ITrimmedCurve).basisCurve !== undefined;
    }

    /**
     * Compute the two tangent points on a circle from an external point.
     * Returns an empty array if the point is inside or on the circle, or not coplanar with it.
     */
    static tangentPoints(circle: ICircle, point: XYZ): XYZ[] {
        const V = point.sub(circle.center);

        // Point must be coplanar with the circle
        if (!MathUtils.almostEqual(V.dot(circle.axis), 0)) return [];

        const d = V.length();
        if (d <= circle.radius) return [];

        const alpha = Math.acos(circle.radius / d);
        const unitV = V.normalize();
        if (!unitV) return [];

        // Rotate the unit vector by ±α around the circle axis to find the two tangent directions
        return [alpha, -alpha]
            .map((a) => unitV.rotate(circle.axis, a))
            .filter((dir): dir is XYZ => dir != null)
            .map((dir) => circle.center.add(dir.multiply(circle.radius)));
    }
}
