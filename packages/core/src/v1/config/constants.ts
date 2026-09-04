// kilocode_change start
// Shared provider config constants re-hosted from @kilocode/kilo-gateway so the
// config v1 schema and the Kilo provider patch no longer depend on the gateway.
// Values are kept identical to the gateway's api/constants.ts so existing config
// files continue to validate.
export const PROMPTS = [
  "codex",
  "gemini",
  "beast",
  "anthropic",
  "trinity",
  "anthropic_without_todo",
  "ling",
  "gpt55",
] as const

export const AI_SDK_PROVIDERS = ["anthropic", "openai", "openai-compatible", "openrouter"] as const
// kilocode_change end