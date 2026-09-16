# DWG WebAssembly Module

Converts between DWG and DXF, so DraftWorks can import and export the format users
actually have.

DWG is AutoCAD's native format. It is closed and undocumented, unlike DXF, which is
Autodesk's published interchange format — but DWG is what drawings are exchanged as in
practice, so it is what import has to accept and what export is asked for. Requiring a
user to convert their file in AutoCAD first is not a workaround: anyone who has AutoCAD
does not need this application.

[LibreDWG](https://github.com/LibreDWG/libredwg) does the work in both directions.
`dwg_wasm_convert` reads a DWG and returns DXF text; `dwg_wasm_write` takes DXF text and
returns DWG bytes. It is compiled to WebAssembly with the same Emscripten toolchain as the
OCCT module, so both conversions run entirely in the browser — no server, and no drawing
leaves the machine. `src/dwg_wasm.c` is a thin bridge that stages the bytes in
Emscripten's in-memory filesystem, because LibreDWG's API speaks in file paths rather than
buffers.

JSON is disabled (`LIBREDWG_DISABLE_JSON`); the JSON/GeoJSON writers are not called.
Write support is on, which is what pulls in the DWG encoder and the DXF→DWG reader. That
pair costs roughly 4.5 MB: the module is ~10.8 MB, ~2.3 MB gzipped, against ~6 MB and
~1.5 MB when it could only read. It is loaded on demand the first time a DWG is opened or
exported — see `packages/wasm/src/dwg.ts`.

## Export is R2000, and cannot be otherwise

`dwg_wasm_write` always produces AutoCAD R2000 (AC1015). This is not a default:
LibreDWG's README puts its writer at "good enough for R1.4 - R2000", its own `dxf2dwg`
lists r2004 and later as planned rather than working, and `encode.c` still carries the
r2004 section maps as WIP. A newer version number in the header would name a binary layout
nothing has written.

This costs the user nothing. DWG readers are backward compatible, so an R2000 file opens
in every AutoCAD since 2000 and in everything else that reads DWG. The export format is
labelled "DWG (AutoCAD 2000)" in the UI rather than a bare "DWG", so nobody has to guess
which release they are getting.

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

`verify.mjs` runs the read direction over LibreDWG's own DWG corpus, which spans R13
through 2018. Those fixtures live in the gitignored checkout rather than in this
repository, so this is not part of `npm test`; run it after changing the bridge or bumping
LibreDWG.

```bash
node cpp/dwg/verify.mjs
```

The write direction needs no fixtures, because the drawing it exports is built in the
test, so it *is* part of `npm test` — see `packages/builder/src/dwgExport.test.ts`. It
writes a DXF, encodes it, decodes it again and checks what survived. Keep it passing:
every failure it has caught so far produced a DWG that was structurally valid and empty,
or silently wrong, rather than an error.

Format detection and the DXF parsing that follows are covered by the normal test suite —
see `packages/app/src/io/`.

## Coverage and licence

LibreDWG reads R13 through 2018 and writes R2000. Older releases (R11/R12 and earlier)
are refused on import with a message naming the version. Decoding is not flawless on every
drawing: proxy entities and some newer object types come through degraded, and entity
types the DXF reader does not model are reported to the user as skipped rather than
silently dropped. Export carries whatever our own DXF writer can express and no more, so
the round-trip notes in `packages/app/src/io/dxf` apply to DWG exactly as to DXF.

`scripts/setup_wasm_deps.mjs` patches three MTEXT group codes in LibreDWG 0.13.3's
`src/dynapi.c`, where `rect_width` and `text_height` both claim code 40. Without it every
exported MTEXT comes back with height 0. Upstream corrected exactly those numbers after
0.13.3, so the patch should be dropped when `LIBREDWG_VERSION` moves past 0.13.4.

LibreDWG is GPL-3.0-or-later. DraftWorks is AGPL-3.0, and GPLv3 §13 expressly permits the
combination, so the resulting work is distributable under the AGPL. Anything linking
LibreDWG inherits copyleft — keep that in mind before adding proprietary components to
this module.
