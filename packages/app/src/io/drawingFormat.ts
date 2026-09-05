// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * What kind of drawing a set of bytes actually is.
 *
 * Extensions are not trusted here, and deliberately so. Drawings arrive by email and
 * through client portals that rename things; a DWG saved as `.dxf` is a routine
 * occurrence, not a pathological one. Every one of these formats announces itself in its
 * first bytes, so sniffing is both more reliable than the filename and free.
 */
export type DrawingFormat = "dwg" | "dxf" | "dxf-binary" | "unknown";

/** Every DWG since R13 opens with `AC10` and a two-digit version code. */
const DWG_PREFIX = "AC10";

/** Binary DXF opens with this sentinel, followed by CR LF SUB NUL. */
const BINARY_DXF_SENTINEL = "AutoCAD Binary DXF";

/**
 * The DWG version codes this build of LibreDWG decodes, mapped to their release names.
 * R13 (AC1012) is the oldest; older codes belong to drawings from before 1994, which no
 * longer circulate. A code missing from this table is equally a release newer than the
 * LibreDWG we build against, which is why the caller reports it as unreadable rather than
 * as too old.
 */
const DWG_VERSIONS: Record<string, string> = {
    AC1012: "R13",
    AC1014: "R14",
    AC1015: "2000",
    AC1018: "2004",
    AC1021: "2007",
    AC1024: "2010",
    AC1027: "2013",
    AC1032: "2018",
};

const ascii = (bytes: Uint8Array, length: number): string => {
    let out = "";
    for (let i = 0; i < length && i < bytes.length; i++) {
        out += String.fromCharCode(bytes[i]);
    }
    return out;
};

export function detectDrawingFormat(bytes: Uint8Array): DrawingFormat {
    const head = ascii(bytes, 22);

    if (head.startsWith(DWG_PREFIX)) return "dwg";
    if (head.startsWith(BINARY_DXF_SENTINEL)) return "dxf-binary";

    // ASCII DXF has no magic number. It is a stream of code/value line pairs, and a
    // well-formed one opens with group code 0 (variably indented, optionally after a 999
    // comment block) followed by SECTION. Scanning the first few lines is enough to tell
    // it apart from arbitrary text without parsing the file twice.
    const prefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 1024));
    const lines = prefix.split(/\r?\n/, 24).map((line) => line.trim());
    for (let i = 0; i + 1 < lines.length; i++) {
        if (lines[i] === "0" && lines[i + 1].toUpperCase() === "SECTION") return "dxf";
    }

    return "unknown";
}

/**
 * The release name for a DWG, or undefined if the version is one LibreDWG cannot read.
 * Used to tell the user *which* version failed rather than just that it did.
 */
export function dwgVersionName(bytes: Uint8Array): string | undefined {
    return DWG_VERSIONS[ascii(bytes, 6)];
}
