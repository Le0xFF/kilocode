import { AnthropicPlugin } from "./provider/anthropic"
import { DynamicProviderPlugin } from "./provider/dynamic"
import { OpenAICompatiblePlugin } from "./provider/openai-compatible"
import { OpenAIPlugin } from "./provider/openai"
import { OpencodePlugin } from "./provider/opencode"
import type { PluginInternal } from "./internal"
import type { Scope } from "effect"

// kilocode_change start - offline surface: only plugins that stay live after the catalog cut are registered
export const ProviderPlugins: PluginInternal.Plugin<PluginInternal.Requirements | Scope.Scope>[] = [
  AnthropicPlugin, // custom provider package @ai-sdk/anthropic (CustomProviderDialog)
  OpenAICompatiblePlugin, // whitelist providers (lmstudio/atomic-chat/privatemode-ai) + custom openai-compatible
  OpenAIPlugin, // custom provider package @ai-sdk/openai (CustomProviderDialog)
  OpencodePlugin, // config-served opencode free-tier gate (A5)
  DynamicProviderPlugin, // fallback for any user-configured npm package
]
// kilocode_change end