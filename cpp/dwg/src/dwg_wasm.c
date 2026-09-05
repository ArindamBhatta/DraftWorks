/* Part of the DraftWorks Project, under the AGPL-3.0 License.
   See LICENSE file in the project root for full license information.

   DWG -> DXF bridge.

   LibreDWG reads DWG and writes DXF, but both halves of its API speak in file
   paths and FILE*, not buffers. Under Emscripten that is not the obstacle it
   looks like: MEMFS gives us a real in-process filesystem, so the drawing is
   staged there and never touches a disk or a network. The browser hands us
   bytes, we hand back DXF text, and the existing DXF reader takes it from
   there - it has no idea the drawing arrived as DWG.

   The result buffer is owned by this module and lives until the next
   dwg_wasm_convert or an explicit dwg_wasm_release, so the JS side can copy it
   out at its leisure. */

#include "config.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <emscripten.h>

#include "dwg.h"

#include "bits.h"
#include "common.h"
#include "out_dxf.h"

#define IN_PATH "/dwg_in.dwg"
#define OUT_PATH "/dwg_out.dxf"

/* LibreDWG packs severity into the error bitmask; anything at or above
   DWG_ERR_CRITICAL means the drawing did not survive reading. Below that the
   entities are usable even though something was off, which is the common case
   for real-world files and must not be treated as failure. */
static char* g_result = NULL;
static size_t g_result_size = 0;
static int g_critical = 0;

static void
release(void)
{
    free(g_result);
    g_result = NULL;
    g_result_size = 0;
    g_critical = 0;
}

static int
stage_input(const unsigned char* data, size_t len)
{
    FILE* fh = fopen(IN_PATH, "wb");
    if (!fh)
        return 0;
    if (len && fwrite(data, 1, len, fh) != len) {
        fclose(fh);
        return 0;
    }
    return fclose(fh) == 0;
}

static int
collect_output(void)
{
    FILE* fh = fopen(OUT_PATH, "rb");
    long size;
    size_t read;

    if (!fh)
        return 0;
    if (fseek(fh, 0, SEEK_END) != 0 || (size = ftell(fh)) < 0) {
        fclose(fh);
        return 0;
    }
    rewind(fh);

    g_result = (char*)malloc((size_t)size + 1);
    if (!g_result) {
        fclose(fh);
        return 0;
    }

    read = fread(g_result, 1, (size_t)size, fh);
    fclose(fh);
    g_result[read] = '\0';
    g_result_size = read;
    return 1;
}

/* Returns the LibreDWG error bitmask, or -1 if the conversion could not be
   staged at all. A return below DWG_ERR_CRITICAL means dwg_wasm_result holds
   DXF text worth parsing, even when non-zero. */
EMSCRIPTEN_KEEPALIVE
int dwg_wasm_convert(const unsigned char* data, size_t len)
{
    Dwg_Data dwg;
    Bit_Chain dat = { 0 };
    int error;

    release();

    if (!data || !len || !stage_input(data, len))
        return -1;

    memset(&dwg, 0, sizeof(Dwg_Data));
    dwg.opts = 0; /* silent: LibreDWG's logging goes to stderr, which is noise in
                     a browser console and costs time on large drawings. */

    error = dwg_read_file(IN_PATH, &dwg);
    if (error >= DWG_ERR_CRITICAL) {
        g_critical = 1;
        dwg_free(&dwg);
        unlink(IN_PATH);
        return error;
    }

    dat.version = dwg.header.version;
    dat.from_version = dwg.header.from_version;
    dat.fh = fopen(OUT_PATH, "wb");
    if (!dat.fh) {
        dwg_free(&dwg);
        unlink(IN_PATH);
        return -1;
    }

    error |= dwg_write_dxf(&dat, &dwg);
    fclose(dat.fh);
    dwg_free(&dwg);
    unlink(IN_PATH);

    if (error >= DWG_ERR_CRITICAL || !collect_output()) {
        g_critical = 1;
        unlink(OUT_PATH);
        return error >= DWG_ERR_CRITICAL ? error : -1;
    }

    unlink(OUT_PATH);
    return error;
}

EMSCRIPTEN_KEEPALIVE
const char*
dwg_wasm_result(void)
{
    return g_critical ? NULL : g_result;
}

EMSCRIPTEN_KEEPALIVE
size_t
dwg_wasm_result_size(void)
{
    return g_critical ? 0 : g_result_size;
}

EMSCRIPTEN_KEEPALIVE
void dwg_wasm_release(void)
{
    release();
}
