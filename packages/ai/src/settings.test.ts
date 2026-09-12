import { ObjectStorage } from "@draftworks/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { AiSetup, DEFAULT_MODELS } from "./settings";

const STORAGE_KEY = "aiSetup";

beforeEach(() => {
    localStorage.clear();
    AiSetup.restore();
});

describe("credentials are held per provider", () => {
    test("a key set for one provider is not lost by using the other", () => {
        AiSetup.configure({ provider: "anthropic", anthropic: { apiKey: "sk-ant-1" } as never });
        AiSetup.configure({ provider: "gemini", gemini: { apiKey: "AIza-1" } as never });

        const settings = AiSetup.settings;
        expect(settings.provider).toBe("gemini");
        expect(settings.anthropic.apiKey).toBe("sk-ant-1");
        expect(settings.gemini.apiKey).toBe("AIza-1");
    });

    test("the active credentials follow the selected provider", () => {
        AiSetup.configure({
            provider: "gemini",
            anthropic: { apiKey: "sk-ant-1" } as never,
            gemini: { apiKey: "AIza-1" } as never,
        });
        expect(AiSetup.active.apiKey).toBe("AIza-1");
        expect(AiSetup.isConfigured).toBe(true);
    });

    test("selecting a provider with no key reads as unconfigured", () => {
        AiSetup.configure({ provider: "anthropic", gemini: { apiKey: "AIza-1" } as never });
        expect(AiSetup.isConfigured).toBe(false);
    });

    test("clearing a model falls back to that provider's default, not to blank", () => {
        AiSetup.configure({ provider: "gemini", gemini: { apiKey: "k", model: "" } as never });
        expect(AiSetup.settings.gemini.model).toBe(DEFAULT_MODELS.gemini);
    });

    test("settings are a copy - editing what you read does not change what is stored", () => {
        AiSetup.configure({ anthropic: { apiKey: "sk-ant-1" } as never });
        AiSetup.settings.anthropic.apiKey = "tampered";
        expect(AiSetup.settings.anthropic.apiKey).toBe("sk-ant-1");
    });
});

describe("reading what is already in storage", () => {
    test("a key saved before Gemini existed is kept, not dropped", () => {
        // The shape this setting had when Anthropic was the only option.
        ObjectStorage.default.setValue(STORAGE_KEY, {
            apiKey: "sk-ant-old",
            model: "claude-opus-5",
            baseURL: "https://proxy.example.com",
        });
        AiSetup.restore();

        expect(AiSetup.settings.provider).toBe("anthropic");
        expect(AiSetup.settings.anthropic.apiKey).toBe("sk-ant-old");
        expect(AiSetup.settings.anthropic.baseURL).toBe("https://proxy.example.com");
        expect(AiSetup.settings.gemini.apiKey).toBe("");
    });

    test("nothing stored yet means defaults, not a crash", () => {
        localStorage.clear();
        expect(AiSetup.restore()).toBe(false);
        expect(AiSetup.settings.provider).toBe("anthropic");
        expect(AiSetup.settings.anthropic.model).toBe(DEFAULT_MODELS.anthropic);
    });

    test("a settings file that has been tampered with does not take the app down", () => {
        ObjectStorage.default.setValue(STORAGE_KEY, { provider: "wat", gemini: "not-an-object" });
        AiSetup.restore();
        expect(AiSetup.settings.provider).toBe("anthropic");
        expect(AiSetup.settings.gemini.model).toBe(DEFAULT_MODELS.gemini);
    });

    test("settings survive a reload", () => {
        AiSetup.configure({ provider: "gemini", gemini: { apiKey: "AIza-1" } as never });
        AiSetup.restore();
        expect(AiSetup.settings.gemini.apiKey).toBe("AIza-1");
    });
});
