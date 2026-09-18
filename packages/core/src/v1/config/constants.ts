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

// kilocode_change - aligned with the packages CustomProviderDialog offers (anthropic/openai/openai-compatible);
// "openrouter" was dropped: it is not a user-configurable custom provider, and its removal from the literals
// changes v1 config decode for existing files setting ai_sdk_provider: "openrouter" (optional field on Model) —
// accepted per the offline contract; that key is only informational for model routing.
export const AI_SDK_PROVIDERS = ["anthropic", "openai", "openai-compatible"] as const
// kilocode_change end
