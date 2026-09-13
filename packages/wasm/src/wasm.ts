import MainModuleFactory, { type MainModule } from "../lib/chili-wasm";

declare global {
    var wasm: MainModule;
}

export interface InitWasmOptions {
    /**
     * Raw bytes of `chili-wasm.wasm`. Required when running under Node (e.g. the
     * MCP server or integration tests), where the Emscripten glue cannot `fetch`
     * the binary. Omit in the browser — Emscripten loads the `.wasm` itself.
     */
    wasmBinary?: BufferSource;
}

export async function initWasm(options?: InitWasmOptions) {
    global.wasm = await MainModuleFactory(
        options?.wasmBinary ? { wasmBinary: options.wasmBinary } : undefined,
    );
    return global.wasm;
}
