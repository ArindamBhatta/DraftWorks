// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { serializable, serialize } from "../serialize";
import type { IEqualityComparer } from "./equalityComparer";
import { Logger } from "./logger";

export interface ResultOptions<T, E = string> {
    isOk: boolean;
    value: T | undefined;
    error: E | undefined;
}

// Result<T, E> exists because almost every call into the OCCT/WASM kernel (build a
// box, boolean two solids, fillet an edge, sweep a profile) can fail on degenerate
// or invalid geometry, and this codebase treats that as an expected, checkable
// outcome rather than an exception - see ShapeNode.shape/generateShape() in
// model/shapeNode.ts, which is typed as Result<IShape> everywhere. Using exceptions
// for this would mean every one of those call sites needs try/catch just to keep
// the document alive after one bad parametric input; a Result return makes the
// failure part of the type signature instead.
@serializable()
export class Result<T, E = string> {
    readonly #isOk: boolean;
    readonly #value: T | undefined;
    readonly #error: E | undefined;

    @serialize()
    get isOk(): boolean {
        return this.#isOk;
    }

    // Accessing .value on an error (or .error on a success) is a caller bug, but a
    // deliberately "soft" one: it logs a warning and returns undefined rather than
    // throwing, so one misuse doesn't crash the whole app - consistent with how
    // ShapeNode.setShape() treats a failed shape as "keep showing the old one," not
    // as a fatal error.
    @serialize()
    get value(): T {
        if (!this.#isOk) Logger.warn("Result is error");
        return this.#value!;
    }

    @serialize()
    get error(): E {
        if (this.#isOk) Logger.warn("Result is ok");
        return this.#error!;
    }

    constructor(options: ResultOptions<T, E>) {
        this.#isOk = options.isOk;
        this.#value = options.value;
        this.#error = options.error;
    }

    parse<U>(): Result<U, E> {
        return Result.err(this.#error as E);
    }

    isOkAnd(predict: (value: T) => boolean): boolean {
        return this.#isOk && predict(this.#value!);
    }

    isErrorOr(predict: (value: T) => boolean): boolean {
        return !this.#isOk || predict(this.#value!);
    }

    unchecked(): T | undefined {
        return this.#value;
    }

    static ok<T>(value: T): Result<T, never> {
        return new Result({ isOk: true, value, error: undefined }) as any;
    }

    static err<E>(error: E): Result<any, E> {
        return new Result({ isOk: false, value: undefined, error }) as any;
    }
}

export class ResultEqualityComparer<T> implements IEqualityComparer<Result<T>> {
    constructor(readonly equal?: (left: T, right: T) => boolean) {}

    equals(left: Result<T>, right: Result<T>): boolean {
        if (!left.isOk || !right.isOk) return false;
        return this.equal ? this.equal(left.value, right.value) : left.value === right.value;
    }
}
