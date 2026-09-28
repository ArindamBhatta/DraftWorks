/**
 * READ FILE ASYNC - Import CAD Files and Assets
 *
 * Enables users to load drawings and design assets into the CAD application:
 *
 * Import scenarios:
 * 1. Open Existing Drawing:
 *    - Load DXF, DWG files from user's computer
 *    - Parse file format and reconstruct geometry, layers, blocks
 *    - Open multiple documents for comparison
 *
 * 2. Import Blocks/Symbols:
 *    - User inserts block library from file
 *    - Import company standard parts and symbols
 *
 * 3. Import Image References:
 *    - Attach images to drawing as background/reference
 *    - Trace over imported sketches or scans
 *
 * 4. Batch Import:
 *    - Import multiple DXF files at once
 *    - Merge multiple drawings into single document
 *
 * Implementation Features:
 * - Handles file selection UI (browser file dialog)
 * - Asynchronous reading (doesn't block UI)
 * - Multiple file support (import multiple files at once)
 * - iOS special handling (accept attribute not supported on iOS)
 * - Result<T> error handling for file read failures
 * - Supports text (DXF/JSON) and binary (images) file types
 *
 * Security:
 * - Only local files (user selects them)
 * - No direct file system access
 * - Uses browser sandboxed file API
 */

import { Result } from "../result";

const isIOS =
    /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase()) ||
    (navigator.maxTouchPoints > 0 && /(Macintosh)/.test(navigator.userAgent));

export async function readFilesAsync(accept: string, multiple: boolean): Promise<Result<FileList>> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = multiple;
        if (!isIOS) {
            input.accept = accept;
        }
        input.style.visibility = "hidden";

        const cleanup = () => document.body.removeChild(input);

        input.onchange = () => {
            cleanup();
            resolve(input.files ? Result.ok(input.files) : Result.err("no files selected"));
        };

        input.oncancel = () => {
            cleanup();
            resolve(Result.err("cancel"));
        };

        document.body.appendChild(input);
        input.click();
    });
}

export interface FileData {
    fileName: string;
    data: string;
}

export async function readFileAsync(
    accept: string,
    multiple: boolean,
    method: "readAsText" | "readAsDataURL" = "readAsText",
): Promise<Result<FileData[]>> {
    const filesResult = await readFilesAsync(accept, multiple);
    return filesResult.isOk ? readInputedFiles(filesResult.value, method) : filesResult.parse();
}

async function readInputedFiles(
    files: FileList,
    method: "readAsText" | "readAsDataURL",
): Promise<Result<FileData[]>> {
    const fileDataPromises = Array.from(files).map(async (file) => {
        const data = await readFileDataAsync(file, method);
        if (!data) {
            throw new Error(`Error occurred reading file: ${file.name}`);
        }
        return { fileName: file.name, data };
    });

    return Promise.try(async () => {
        const result = await Promise.all(fileDataPromises);
        return Result.ok(result);
    }).catch((error) => {
        return Result.err((error as Error).message);
    });
}

function readFileDataAsync(file: File, method: "readAsText" | "readAsDataURL"): Promise<string | null> {
    return new Promise((resolve) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            if (e.target?.readyState === FileReader.DONE) {
                resolve(e.target.result as string);
            }
        };

        reader.onerror = () => resolve(null);
        reader[method](file);
    });
}
