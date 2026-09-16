import type { MainModule } from "../lib/dwg-wasm";

/**
 * Thrown when LibreDWG could not get a drawing out of the bytes at all - a file that is
 * not a DWG, or one damaged past the point where the entity list can be trusted. Damage
 * that LibreDWG can work around does not throw: partial drawings are worth more to the
 * user than an error, so those come back as DXF with whatever survived.
 */
export class DwgReadError extends Error {}

/**
 * Thrown when a DXF could not be turned into a DWG. Unlike reading, there is no partial
 * result worth keeping: a DWG that failed to encode is not a drawing with some entities
 * missing, it is a file AutoCAD will refuse to open, and handing the user one of those is
 * worse than telling them the export failed.
 */
export class DwgWriteError extends Error {}

export interface DwgWasmOptions {
    /**
     * Raw bytes of `dwg-wasm.wasm`. Required under Node, where the Emscripten glue cannot
     * `fetch` the binary next to itself. Omit in the browser.
     */
    wasmBinary?: BufferSource;
}

let modulePromise: Promise<MainModule> | undefined;

/**
 * The module is large, so it is fetched on the first DWG opened or exported rather than
 * at startup - a session that only ever touches DXF never pays for it. The dynamic import
 * is what lets the bundler split it out; the promise is cached so the next DWG in either
 * direction reuses the instance.
 */
function loadModule(options?: DwgWasmOptions): Promise<MainModule> {
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
export async function dwgToDxf(bytes: Uint8Array, options?: DwgWasmOptions): Promise<string> {
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

/**
 * Converts ASCII DXF text to DWG bytes, at AutoCAD R2000.
 *
 * The version is fixed, and cannot be raised by passing one in: LibreDWG's encoder only
 * produces R13-R2000, and everything above that is still marked unfinished upstream. A
 * newer number in the header would name a binary layout nothing has written. R2000 is no
 * real restriction on the user - DWG readers are backward compatible, so the file opens
 * in every AutoCAD since 2000 and in the other CAD applications that read DWG at all.
 *
 * Runs entirely locally, like the read direction: nothing is uploaded.
 */
export async function dxfToDwg(dxf: string, options?: DwgWasmOptions): Promise<Uint8Array<ArrayBuffer>> {
    if (dxf.length === 0) {
        throw new DwgWriteError("empty drawing");
    }

    const module = await loadModule(options);

    // Present only when dwg-wasm was built with LibreDWG's write support on. A build that
    // turned it off still loads and still imports DWG, so the miss would otherwise surface
    // as "not a function" from inside the glue, pointing at nothing. See cpp/dwg/README.md.
    if (typeof module._dwg_wasm_write !== "function") {
        throw new DwgWriteError("dwg-wasm was built without write support; rebuild it");
    }

    // LibreDWG's DXF reader takes bytes, and the text has to reach it as the UTF-8 its
    // parser assumes rather than as UTF-16 code units.
    const bytes = new TextEncoder().encode(dxf);
    const pointer = module._malloc(bytes.length);
    if (pointer === 0) {
        throw new DwgWriteError("out of memory");
    }

    try {
        module.HEAPU8.set(bytes, pointer);

        const code = module._dwg_wasm_write(pointer, bytes.length);
        const size = module._dwg_wasm_result_size();
        const result = module._dwg_wasm_result();
        if (result === 0 || size === 0) {
            throw new DwgWriteError(`libredwg error 0x${(code >>> 0).toString(16)}`);
        }

        // Copied out before the release, and re-read from HEAPU8 for the same reason as
        // the read path: encoding a large drawing can grow the heap and detach the view.
        //
        // Allocated here rather than taken from HEAPU8.slice, which would carry the heap's
        // own buffer type: Emscripten types HEAPU8 as a plain Uint8Array, so a slice of it
        // is backed by ArrayBufferLike, and that includes SharedArrayBuffer, which a Blob
        // cannot be built from. Owning the buffer says what is true - this is a detached
        // copy - and costs the same one pass as the slice would.
        const dwg = new Uint8Array(size);
        dwg.set(module.HEAPU8.subarray(result, result + size));
        module._dwg_wasm_release();
        return dwg;
    } finally {
        module._free(pointer);
    }
}
