import { type IConverter, Result, XY, XYZ } from "@chili3d/core";

export class XYConverter implements IConverter<XY> {
    convert(value: XY) {
        return Result.ok(`${value.x},${value.y}`);
    }

    convertBack(value: string): Result<XY> {
        const vs = value.split(",").map(Number).filter(isFinite);
        return vs.length === 2
            ? Result.ok(new XY({ x: vs[0], y: vs[1] }))
            : Result.err(`${value} convert to XY error`);
    }
}

export class XYZConverter implements IConverter<XYZ> {
    convert(value: XYZ) {
        return Result.ok(`${value.x},${value.y},${value.z}`);
    }

    convertBack(value: string): Result<XYZ> {
        const vs = value.split(",").map(Number).filter(isFinite);
        return vs.length === 3 ? Result.ok(XYZ.fromArray(vs)) : Result.err(`${value} convert to XYZ error`);
    }
}
