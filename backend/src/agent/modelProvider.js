import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogle } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const PROVIDER_DEFAULTS = {
  claude: { defaultModel: "claude-sonnet-4-6" },
  openai: { defaultModel: "gpt-4o" },
  openrouter: { defaultModel: "openai/gpt-4-turbo" },
  zai: {
    defaultModel: "glm-4.5-flash",
    baseURL: "https://api.z.ai/api/paas/v4",
  },
  google: { defaultModel: "gemini-2.0-flash" },
  custom: { defaultModel: "llama3", baseURL: "http://localhost:11434/v1" },
};

const API_KEY_ENV = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  zai: "ZAI_API_KEY",
  google: "GOOGLE_API_KEY",
  custom: "CUSTOM_API_KEY",
};

function buildModelForProvider(provider, modelId, overrides = {}) {
  const cfg = PROVIDER_DEFAULTS[provider];
  if (!cfg) throw new Error(`Unknown LLM provider: ${provider}`);

  const envVar = API_KEY_ENV[provider];
  const apiKey =
    overrides.apiKey ||
    process.env[envVar] ||
    (provider === "custom" ? "ollama" : undefined);
  if (!apiKey)
    throw new Error(
      `No ${provider} API key configured (set ${envVar} or a per-role override in .env)`,
    );

  const resolvedModel = modelId || cfg.defaultModel;

  if (provider === "claude") return createAnthropic({ apiKey })(resolvedModel);
  if (provider === "google") {
    const google = createGoogle({ apiKey });
    return google(resolvedModel);
  }
  if (provider === "openrouter") {
    const openrouter = createOpenRouter({ apiKey });
    return openrouter(resolvedModel);
  }

  const baseURL =
    overrides.baseURL ||
    (provider === "custom"
      ? process.env.CUSTOM_BASE_URL || cfg.baseURL
      : cfg.baseURL);
  console.log(
    `[agent] Using baseURL for provider ${provider}: ${baseURL}, apiKey: ${apiKey}`,
  );
  return createOpenAI({ baseURL, apiKey }).chat(resolvedModel);
}

export function getModelForRole(role) {
  console.log(`[agent] Resolving model for role: ${role}`);
  const prefix = role.toUpperCase();
  const provider =
    process.env[`${prefix}_LLM_PROVIDER`] ||
    process.env.LLM_PROVIDER ||
    "claude";
  const modelId =
    process.env[`${prefix}_LLM_MODEL`] ||
    process.env.LLM_MODEL ||
    (provider === "custom" ? process.env.CUSTOM_MODEL : undefined);
  const overrides = {
    apiKey: process.env[`${prefix}_LLM_API_KEY`],
    baseURL: process.env[`${prefix}_LLM_BASE_URL`],
  };
  console.log(
    `[agent] Using overrides for role provider: ${provider}, model: ${modelId}, API key: ${overrides.apiKey}, baseURL: ${overrides.baseURL}`,
  );
  return buildModelForProvider(provider, modelId, overrides);
}
