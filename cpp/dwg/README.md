# DWG WebAssembly Module

Reads DWG drawings and hands them back as DXF text, so DraftWorks can import the format
users actually have.

DWG is AutoCAD's native format. It is closed and undocumented, unlike DXF, which is
Autodesk's published interchange format — but DWG is what drawings are exchanged as in
practice, so it is what import has to accept. Requiring a user to convert their file in
AutoCAD first is not a workaround: anyone who has AutoCAD does not need this application.

[LibreDWG](https://github.com/LibreDWG/libredwg) does the decoding. It is compiled to
WebAssembly with the same Emscripten toolchain as the OCCT module, so the conversion runs
entirely in the browser — no server, and no drawing leaves the machine. `src/dwg_wasm.c`
is a thin bridge that stages the bytes in Emscripten's in-memory filesystem, because
LibreDWG's API speaks in file paths rather than buffers.

Only the decoder and the DXF writer are built in (`LIBREDWG_DISABLE_WRITE`,
`LIBREDWG_DISABLE_JSON`); the DWG encoder and the JSON/GeoJSON writers are not used and
are most of the binary. The result is ~6 MB, ~1.5 MB gzipped, and is loaded on demand the
first time a DWG is opened — see `packages/wasm/src/dwg.ts`.

## Build

Dependencies come from the repository-wide setup, which clones LibreDWG into
`cpp/build/libredwg`:

```bash
npm run setup:wasm
```

Then:

```bash
npm run build:wasm:dwg
```

The output is installed to `packages/wasm/lib/dwg-wasm.{js,wasm,d.ts}`.

## Verifying

`verify.mjs` runs the bridge over LibreDWG's own DWG corpus, which spans R13 through 2018.
Those fixtures live in the gitignored checkout rather than in this repository, so this is
not part of `npm test`; run it after changing the bridge or bumping LibreDWG.

```bash
node cpp/dwg/verify.mjs
```

Format detection and the DXF parsing that follows are covered by the normal test suite —
see `packages/app/src/io/`.

## Coverage and licence

LibreDWG reads R13 through 2018. Older releases (R11/R12 and earlier) are refused with a
message naming the version. Decoding is not flawless on every drawing: proxy entities and
some newer object types come through degraded, and entity types the DXF reader does not
model are reported to the user as skipped rather than silently dropped.

LibreDWG is GPL-3.0-or-later. DraftWorks is AGPL-3.0, and GPLv3 §13 expressly permits the
combination, so the resulting work is distributable under the AGPL. Anything linking
LibreDWG inherits copyleft — keep that in mind before adding proprietary components to
this module.
