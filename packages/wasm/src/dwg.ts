// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { MainModule } from "../lib/dwg-wasm";

/**
 * Thrown when LibreDWG could not get a drawing out of the bytes at all - a file that is
 * not a DWG, or one damaged past the point where the entity list can be trusted. Damage
 * that LibreDWG can work around does not throw: partial drawings are worth more to the
 * user than an error, so those come back as DXF with whatever survived.
 */
export class DwgReadError extends Error {}

export interface DwgToDxfOptions {
    /**
     * Raw bytes of `dwg-wasm.wasm`. Required under Node, where the Emscripten glue cannot
     * `fetch` the binary next to itself. Omit in the browser.
     */
    wasmBinary?: BufferSource;
}

let modulePromise: Promise<MainModule> | undefined;

/**
 * The module is ~6 MB, so it is fetched on the first DWG opened rather than at startup -
 * a session that only ever touches DXF never pays for it. The dynamic import is what lets
 * the bundler split it out; the promise is cached so a second DWG reuses the instance.
 */
function loadModule(options?: DwgToDxfOptions): Promise<MainModule> {
    modulePromise ??= import("../lib/dwg-wasm.js").then((glue) =>
        glue.default(options?.wasmBinary ? { wasmBinary: options.wasmBinary } : undefined),
    );
    return modulePromise;
}

/**
 * Converts DWG bytes to ASCII DXF text.
 *
 * The whole point of this module: DWG is what users actually have, DXF is what can be
 * parsed. Nothing leaves the machine - LibreDWG runs in WebAssembly and stages the
 * drawing in Emscripten's in-memory filesystem.
 */
export async function dwgToDxf(bytes: Uint8Array, options?: DwgToDxfOptions): Promise<string> {
    if (bytes.length === 0) {
        throw new DwgReadError("empty file");
    }

    const module = await loadModule(options);
    const pointer = module._malloc(bytes.length);
    if (pointer === 0) {
        throw new DwgReadError("out of memory");
    }

    try {
        module.HEAPU8.set(bytes, pointer);

        const code = module._dwg_wasm_convert(pointer, bytes.length);
        const size = module._dwg_wasm_result_size();
        const result = module._dwg_wasm_result();
        if (result === 0 || size === 0) {
            throw new DwgReadError(`libredwg error 0x${(code >>> 0).toString(16)}`);
        }

        // HEAPU8 is re-read here rather than cached above: the module is built with
        // ALLOW_MEMORY_GROWTH, and a large drawing can grow the heap during the
        // conversion, which detaches the old view.
        const text = new TextDecoder("utf-8").decode(module.HEAPU8.slice(result, result + size));
        module._dwg_wasm_release();
        return text;
    } finally {
        module._free(pointer);
    }
}
