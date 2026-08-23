import { type IConverter, Result } from "@chili3d/core";

export class UrlStringConverter implements IConverter<string> {
    convert(value: string): Result<string> {
        return Result.ok(`url('${value}')`);
    }
}
