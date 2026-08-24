// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export interface StartupParams {
    readonly plugins: string[];
    readonly fileUrl: string | undefined;
}

/**
 * Parse the startup query string: each repeated `plugin` param is loaded as a
 * plugin, and `url` (falling back to `model`) points to a file to open.
 */
export function parseStartupParams(search: string): StartupParams {
    const params = new URLSearchParams(search);
    return {
        plugins: params.getAll("plugin").filter((x) => x.trim().length > 0),
        fileUrl: params.get("url") ?? params.get("model") ?? undefined,
    };
}
