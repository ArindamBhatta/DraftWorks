export interface StartupParams {
    readonly plugins: string[];
    readonly fileUrl: string | undefined;
}

export function parseStartupParams(search: string): StartupParams {
    const params = new URLSearchParams(search);
    return {
        plugins: params.getAll("plugin").filter((x) => x.trim().length > 0),
        fileUrl: params.get("url") ?? params.get("model") ?? undefined,
    };
}
