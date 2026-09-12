import { ObjectStorage } from "@draftworks/core";

export type ProviderId = "anthropic" | "gemini";
export const PROVIDER_IDS: readonly ProviderId[] = ["anthropic", "gemini"];

/**
 * DraftWorks has no backend, so a request goes straight from the page. That means the
 * key lives in this browser's localStorage and anything running in the page can read
 * it - use a key created for this and nothing else. `baseURL` is the way out for anyone
 * who would rather run a proxy and keep the key server-side.
 */
export interface ProviderSettings {
    apiKey: string;
    model: string;
    /** Optional proxy endpoint. Empty means talk to the provider directly. */
    baseURL: string;
}

export interface AiSettings {
    provider: ProviderId;
    anthropic: ProviderSettings;
    gemini: ProviderSettings;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
    anthropic: "Anthropic Claude",
    gemini: "Google Gemini",
};

export const DEFAULT_MODELS: Record<ProviderId, string> = {
    anthropic: "claude-opus-5",
    gemini: "gemini-2.5-pro",
};

const STORAGE_KEY = "aiSetup";

function defaults(): AiSettings {
    return {
        provider: "anthropic",
        anthropic: { apiKey: "", model: DEFAULT_MODELS.anthropic, baseURL: "" },
        gemini: { apiKey: "", model: DEFAULT_MODELS.gemini, baseURL: "" },
    };
}

/** Keys are kept per provider, so trying the other one does not throw the first away. */
export class AiSetup {
    static #settings: AiSettings = defaults();
    static #restored = false;

    /** Establishes settings from storage. Nothing stored means defaults, not whatever
     * happened to be in memory - restore describes the stored state or the absence of it. */
    static restore(): boolean {
        const stored = ObjectStorage.default.value<Record<string, unknown>>(STORAGE_KEY);
        AiSetup.#restored = true;
        AiSetup.#settings = stored ? migrate(stored) : defaults();
        return stored !== undefined;
    }

    static get settings(): AiSettings {
        if (!AiSetup.#restored) AiSetup.restore();
        const current = AiSetup.#settings;
        return {
            provider: current.provider,
            anthropic: { ...current.anthropic },
            gemini: { ...current.gemini },
        };
    }

    /** The credentials for whichever provider is selected. */
    static get active(): ProviderSettings {
        const settings = AiSetup.settings;
        return settings[settings.provider];
    }

    static configure(update: Partial<AiSettings>): void {
        const current = AiSetup.settings;
        const next: AiSettings = {
            provider: update.provider ?? current.provider,
            anthropic: { ...current.anthropic, ...update.anthropic },
            gemini: { ...current.gemini, ...update.gemini },
        };
        for (const id of PROVIDER_IDS) {
            if (!next[id].model) next[id].model = DEFAULT_MODELS[id];
        }
        AiSetup.#settings = next;
        AiSetup.#restored = true;
        ObjectStorage.default.setValue(STORAGE_KEY, next);
    }

    /** Whether a request can be attempted at all with the selected provider. */
    static get isConfigured(): boolean {
        return AiSetup.active.apiKey.trim().length > 0;
    }
}

/**
 * Reads whatever is in storage, including the single-provider shape this setting had
 * before Gemini was an option - an existing key is folded into Anthropic rather than
 * silently dropped on upgrade.
 */
function migrate(stored: Record<string, unknown>): AiSettings {
    const base = defaults();
    if (typeof stored["apiKey"] === "string") {
        base.anthropic = {
            apiKey: String(stored["apiKey"] ?? ""),
            model: String(stored["model"] ?? DEFAULT_MODELS.anthropic),
            baseURL: String(stored["baseURL"] ?? ""),
        };
        return base;
    }

    const provider = stored["provider"];
    if (provider === "anthropic" || provider === "gemini") base.provider = provider;
    for (const id of PROVIDER_IDS) {
        const section = stored[id];
        if (typeof section !== "object" || section === null) continue;
        const values = section as Record<string, unknown>;
        base[id] = {
            apiKey: String(values["apiKey"] ?? ""),
            model: String(values["model"] || DEFAULT_MODELS[id]),
            baseURL: String(values["baseURL"] ?? ""),
        };
    }
    return base;
}
