// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execAsync } from "./common.mjs";

const CPP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../cpp/");
const BUILD_DIR = path.resolve(CPP_ROOT, "build");

const EMSDK_DIR_NAME = "emsdk";
const EMSDK_DIR = path.resolve(BUILD_DIR, EMSDK_DIR_NAME);

const OCCT_DIR_NAME = "occt";
const OCCT_DIR = path.resolve(BUILD_DIR, OCCT_DIR_NAME);

const LIBREDWG_DIR_NAME = "libredwg";
const LIBREDWG_DIR = path.resolve(BUILD_DIR, LIBREDWG_DIR_NAME);
const LIBREDWG_VERSION = "0.13.3";

/**
 * Due to a WebXR error, we need to use --skipLibCheck
 */
async function fixEmscripten() {
    const file = path.resolve(EMSDK_DIR, "upstream/emscripten/tools/emscripten.py");
    let contents = fs.readFileSync(file, "utf8");
    contents = contents.replace(
        `cmd = tsc + ['--outFile', tsc_output_file, '--declaration', '--emitDeclarationOnly', '--allowJs', js_doc_file]`,
        `cmd = tsc + ['--outFile', tsc_output_file, '--declaration', '--skipLibCheck', '--emitDeclarationOnly', '--allowJs', js_doc_file]`,
    );
    fs.writeFileSync(file, contents, "utf8");

    console.log(`Fixed emscripten.py`);
}

/**
 * LibreDWG stamps its version into a 999 comment at the top of every DXF it writes, and
 * derives that version with `git describe`. Run from a build directory inside this repo,
 * that describes DraftWorks rather than LibreDWG, so every converted drawing gets
 * labelled with an unrelated commit hash - misleading to anyone later reading the file to
 * work out what produced it.
 *
 * LibreDWG does read a .version file in preference to git, but it tests for it with a
 * relative path, which CMake resolves against the build directory rather than the source
 * tree, so the file alone is never found. Anchoring that test to the source directory
 * makes the pin take effect.
 */
async function pinLibreDwgVersion() {
    fs.writeFileSync(path.resolve(LIBREDWG_DIR, ".version"), LIBREDWG_VERSION, "utf8");

    const file = path.resolve(LIBREDWG_DIR, "CMakeLists.txt");
    let contents = fs.readFileSync(file, "utf8");
    contents = contents.replace(
        `if (EXISTS ".version")\n  file(READ .version NL_PACKAGE_VERSION)`,
        `if (EXISTS "\${CMAKE_CURRENT_SOURCE_DIR}/.version")\n  file(READ "\${CMAKE_CURRENT_SOURCE_DIR}/.version" NL_PACKAGE_VERSION)`,
    );
    fs.writeFileSync(file, contents, "utf8");

    console.log(`Pinned libredwg version to ${LIBREDWG_VERSION}`);
}

/**
 * Corrects MTEXT's DXF group codes in LibreDWG's field table.
 *
 * 0.13.3 has `rect_width` and `text_height` both claiming code 40, and `rect_height`
 * claiming 41. The DXF specification assigns 40 to the text height, 41 to the reference
 * rectangle width and 46 to its height, so a lookup by code 40 finds `rect_width` first
 * and an MTEXT's text height is written into the wrong field on the way in - which is the
 * path DWG export takes, so exported text comes out sized 0. Upstream fixed exactly these
 * three numbers after 0.13.3; this is that fix, no more.
 *
 * dynapi.c is generated from dwg.spec by src/gen-dynapi.pl, but the build compiles the
 * checked-in file and only regenerates it through the separate `regen-dynapi` target, so
 * patching it here holds. Drop this once LIBREDWG_VERSION passes 0.13.4.
 */
async function fixLibreDwgMTextCodes() {
    const file = path.resolve(LIBREDWG_DIR, "src/dynapi.c");
    let contents = fs.readFileSync(file, "utf8");

    // Keyed on the struct offset, which names the field and the entity together, so
    // neither the identically named fields on other entities nor the shared code 40 can
    // be hit by accident. text_height is listed although it does not move, so that a
    // version where it has shifted is caught here rather than silently mis-parsed.
    const corrections = [
        ["rect_height", 41, 46],
        ["rect_width", 40, 41],
        ["text_height", 40, 40],
    ];

    for (const [field, from, to] of corrections) {
        const entry = (code) => `OFF (struct _dwg_entity_MTEXT, ${field}),\n    0,0,0, ${code} }`;

        // Setup re-runs over an existing checkout, so a field already corrected is the
        // expected state, not a failure.
        if (from !== to && contents.includes(entry(to))) continue;

        if (!contents.includes(entry(from))) {
            throw new Error(
                `libredwg ${LIBREDWG_VERSION}: MTEXT.${field} is not at DXF code ${from} ` +
                    `in src/dynapi.c. Check whether this patch is still needed before removing it.`,
            );
        }
        contents = contents.replace(entry(from), entry(to));
    }

    fs.writeFileSync(file, contents, "utf8");

    console.log(`Corrected libredwg MTEXT DXF codes`);
}

const libs = [
    {
        name: "emscripten",
        url: "https://github.com/emscripten-core/emsdk.git",
        tag: "5.0.7",
        dir: EMSDK_DIR,
        actions: [fixEmscripten],
        commands: [
            `${EMSDK_DIR}/emsdk install latest`,
            `${EMSDK_DIR}/emsdk activate --embedded latest`,
            `cd ${EMSDK_DIR}/upstream/emscripten && npm i`,
        ],
    },
    {
        name: "occt",
        url: "https://github.com/Open-Cascade-SAS/OCCT.git",
        tag: "V8_0_0",
        dir: OCCT_DIR,
        actions: [],
        commands: [],
    },
    {
        name: "libredwg",
        url: "https://github.com/LibreDWG/libredwg.git",
        tag: "0.13.3",
        dir: LIBREDWG_DIR,
        actions: [pinLibreDwgVersion, fixLibreDwgMTextCodes],
        commands: [],
    },
];

async function setupLibs() {
    for (const lib of libs) {
        await cloneLibIfNotExists(lib);

        console.log(`Seting up ${lib.name}...`);

        for (const command of lib.commands) {
            await execAsync(command);
        }
        for (const action of lib.actions) {
            await action();
        }
    }
}

async function cloneLibIfNotExists(lib) {
    if (!fs.existsSync(lib.dir)) {
        console.log(`Cloning ${lib.name}...`);
        await execAsync(`git clone --depth=1 -b ${lib.tag} ${lib.url} ${lib.dir}`);

        if (!fs.existsSync(lib.dir)) {
            console.error(`Failed to clone ${lib.name}`);
            process.exit(1);
        }
    }
}

function main() {
    if (!fs.existsSync(BUILD_DIR)) {
        fs.mkdirSync(BUILD_DIR);
    }

    setupLibs()
        .then((_e) => {
            console.log("Setup complete");
        })
        .catch((err) => {
            console.error(err);
        });
}

main();
