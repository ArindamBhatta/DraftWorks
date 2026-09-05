// Part of the DraftWorks Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.
//
// Smoke-checks the dwg-wasm bridge against LibreDWG's own DWG corpus, which
// spans R13 through 2018. Not part of the test suite - those fixtures are not
// vendored - but the thing to run after touching the C bridge or bumping
// LibreDWG. Usage: node cpp/dwg/verify.mjs

import fs from "node:fs";
import path from "node:path";
import initDwgWasm from "../build/target/dwg-release/dwg-wasm.js";

const CORPUS = path.resolve(import.meta.dirname, "../build/libredwg/test/test-data");

const files = fs
    .readdirSync(CORPUS)
    .filter((f) => f.toLowerCase().endsWith(".dwg"))
    .sort();

// The module is built for the browser, so it cannot locate its own .wasm here; the
// binary is handed in, the same way packages/wasm does for Node callers.
const module = await initDwgWasm({
    wasmBinary: fs.readFileSync(
        path.resolve(import.meta.dirname, "../build/target/dwg-release/dwg-wasm.wasm"),
    ),
});

const convert = (bytes) => {
    const ptr = module._malloc(bytes.length);
    module.HEAPU8.set(bytes, ptr);
    try {
        const code = module.ccall("dwg_wasm_convert", "number", ["number", "number"], [ptr, bytes.length]);
        const size = module.ccall("dwg_wasm_result_size", "number", [], []);
        const out = module.ccall("dwg_wasm_result", "number", [], []);
        const dxf = out && size ? module.UTF8ToString(out, size) : "";
        module.ccall("dwg_wasm_release", null, [], []);
        return { code, dxf };
    } finally {
        module._free(ptr);
    }
};

let ok = 0;
for (const name of files) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(CORPUS, name)));
    let result;
    try {
        result = convert(bytes);
    } catch (error) {
        console.log(`FAIL  ${name.padEnd(22)} threw ${error}`);
        continue;
    }

    const entities = (result.dxf.match(/^ *0\r?\nSECTION\r?\n *2\r?\nENTITIES/m) ?? []).length;
    if (result.dxf.length > 0 && entities > 0) {
        ok++;
        console.log(
            `ok    ${name.padEnd(22)} ${String(bytes.length).padStart(8)} B dwg -> ` +
                `${String(result.dxf.length).padStart(9)} B dxf  (err 0x${(result.code >>> 0).toString(16)})`,
        );
    } else {
        console.log(
            `FAIL  ${name.padEnd(22)} code 0x${(result.code >>> 0).toString(16)}, ${result.dxf.length} B`,
        );
    }
}

console.log(`\n${ok}/${files.length} converted`);
process.exit(ok === files.length ? 0 : 1);
