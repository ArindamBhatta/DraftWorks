/* Part of the DraftWorks Project, under the AGPL-3.0 License.
   See LICENSE file in the project root for full license information.

   DWG <-> DXF bridge.

   LibreDWG reads DWG and writes DXF, but both halves of its API speak in file
   paths and FILE*, not buffers. Under Emscripten that is not the obstacle it
   looks like: MEMFS gives us a real in-process filesystem, so the drawing is
   staged there and never touches a disk or a network. The browser hands us
   bytes, we hand back DXF text, and the existing DXF reader takes it from
   there - it has no idea the drawing arrived as DWG.

   dwg_wasm_write is the same trick pointed the other way, for export: our own
   DXF writer's output goes in, a DWG comes back. It targets R2000 and nothing
   else, because R2000 is the newest release LibreDWG's encoder actually
   produces - see the note on dwg_wasm_write.

   One result buffer serves both directions. It is owned by this module and
   lives until the next conversion or an explicit dwg_wasm_release, so the JS
   side can copy it out at its leisure. DXF comes back as text and DWG as
   binary; dwg_wasm_result_size is exact either way, so the caller slices by
   size rather than looking for a terminator. */

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

#define DWG_IN_PATH "/dwg_in.dwg"
#define DXF_OUT_PATH "/dwg_out.dxf"
#define DXF_IN_PATH "/dxf_in.dxf"
#define DWG_OUT_PATH "/dxf_out.dwg"

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
stage_input(const char* path, const unsigned char* data, size_t len)
{
    FILE* fh = fopen(path, "wb");
    if (!fh)
        return 0;
    if (len && fwrite(data, 1, len, fh) != len) {
        fclose(fh);
        return 0;
    }
    return fclose(fh) == 0;
}

static int
collect_output(const char* path)
{
    FILE* fh = fopen(path, "rb");
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

    if (!data || !len || !stage_input(DWG_IN_PATH, data, len))
        return -1;

    memset(&dwg, 0, sizeof(Dwg_Data));
    dwg.opts = 0; /* silent: LibreDWG's logging goes to stderr, which is noise in
                     a browser console and costs time on large drawings. */

    error = dwg_read_file(DWG_IN_PATH, &dwg);
    if (error >= DWG_ERR_CRITICAL) {
        g_critical = 1;
        dwg_free(&dwg);
        unlink(DWG_IN_PATH);
        return error;
    }

    dat.version = dwg.header.version;
    dat.from_version = dwg.header.from_version;
    dat.fh = fopen(DXF_OUT_PATH, "wb");
    if (!dat.fh) {
        dwg_free(&dwg);
        unlink(DWG_IN_PATH);
        return -1;
    }

    error |= dwg_write_dxf(&dat, &dwg);
    fclose(dat.fh);
    dwg_free(&dwg);
    unlink(DWG_IN_PATH);

    if (error >= DWG_ERR_CRITICAL || !collect_output(DXF_OUT_PATH)) {
        g_critical = 1;
        unlink(DXF_OUT_PATH);
        return error >= DWG_ERR_CRITICAL ? error : -1;
    }

    unlink(DXF_OUT_PATH);
    return error;
}

/* DXF text -> DWG bytes, for export.

   R2000 is not a default that can be widened later by passing a version in.
   LibreDWG's encoder stops there: its README puts the writer at "good enough
   for R1.4 - R2000", dxf2dwg documents r2004 and up as planned rather than
   working, and encode.c still carries the r2004 section maps as WIP. Asking
   for a newer release would produce a file stamped with a version whose layout
   was never written. It costs the caller nothing: DWG readers are backward
   compatible, so an R2000 file opens in every AutoCAD since 2000, and in
   everything else that reads DWG at all.

   Returns the LibreDWG error bitmask, or -1 if the conversion could not be
   staged. Below DWG_ERR_CRITICAL the result holds a DWG worth saving even when
   the code is non-zero, matching dwg_wasm_convert. */
EMSCRIPTEN_KEEPALIVE
int dwg_wasm_write(const unsigned char* data, size_t len)
{
    Dwg_Data dwg;
    int error;

    release();

    if (!data || !len || !stage_input(DXF_IN_PATH, data, len))
        return -1;

    memset(&dwg, 0, sizeof(Dwg_Data));
    dwg.opts = 0; /* silent, as in dwg_wasm_convert. */

    /* Set before the read, not after: dxf_read_file clears the whole struct but
       deliberately carries header.version across, so this is how the target
       release reaches the parser. */
    dwg.header.version = R_2000;

    error = dxf_read_file(DXF_IN_PATH, &dwg);
    unlink(DXF_IN_PATH);
    if (error >= DWG_ERR_CRITICAL) {
        g_critical = 1;
        dwg_free(&dwg);
        return error;
    }

    /* from_version is not carried across that clear, and the encoder reads it
       to decide what it is converting from. Left at R_INVALID it encodes
       against a version that does not exist. */
    dwg.header.version = R_2000;
    if (dwg.header.from_version == R_INVALID)
        dwg.header.from_version = R_2000;

    /* dwg_write_file refuses to overwrite an existing file rather than
       truncating it, so a leftover from an export that failed part way would
       silently fail every export after it for the life of the page. */
    unlink(DWG_OUT_PATH);
    error |= dwg_write_file(DWG_OUT_PATH, &dwg);
    dwg_free(&dwg);

    if (error >= DWG_ERR_CRITICAL || !collect_output(DWG_OUT_PATH)) {
        g_critical = 1;
        unlink(DWG_OUT_PATH);
        return error >= DWG_ERR_CRITICAL ? error : -1;
    }

    unlink(DWG_OUT_PATH);
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
