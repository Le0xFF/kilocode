import { afterEach, expect, test } from "bun:test"
import { mkdir, unlink } from "fs/promises"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Effect, Layer } from "effect"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { disposeAllInstances, provideInstanceEffect, tmpdirScoped, TestInstance } from "../fixture/fixture"
import { markPluginDependenciesReady } from "../fixture/plugin"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Env } from "../../src/env"
import { Plugin } from "../../src/plugin/index"
import { Provider } from "@/provider/provider"

import { RuntimeFlags } from "@/effect/runtime-flags"
import { Filesystem } from "@/util/filesystem"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { testEffect, pollWithTimeout } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const originalEnv = new Map<string, string | undefined>()

const rememberEnv = (k: string) => {
  if (!originalEnv.has(k)) originalEnv.set(k, process.env[k])
}

const setProcessEnv = (k: string, v: string) =>
  Effect.sync(() => {
    rememberEnv(k)
    process.env[k] = v
  })

const set = (k: string, v: string) =>
  Effect.gen(function* () {
    rememberEnv(k)
    process.env[k] = v
    yield* Env.use.set(k, v)
  })

const remove = (k: string) =>
  Effect.gen(function* () {
    rememberEnv(k)
    delete process.env[k]
    yield* Env.use.remove(k)
  })

afterEach(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  originalEnv.clear()
  await disposeAllInstances()
})

const providerLayer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  LayerNode.compile(
    LayerNode.group([
      Provider.node,
      FSUtil.node,
      Env.node,
      Config.node,
      Auth.node,
      Plugin.node,
      ModelsDev.node,
      RuntimeFlags.node,
    ]),
    [[RuntimeFlags.node, RuntimeFlags.layer(flags)]],
  )

const list = Provider.use.list()

// kilocode_change - offline surface: wait for the provider state to settle before asserting (instance bootstrap is async)
const waitFor = <T>(check: (providers: any) => T | undefined, message: string) =>
  pollWithTimeout(list.pipe(Effect.map(check)), message)
const hasProvider = (id: string) => (providers: any) => ((providers as any)[id] ? true : undefined)

const paid = (providers: Record<string, { models: Record<string, { cost: { input: number } }> }>) => {
  const item = providers[ProviderV2.ID.make("lmstudio")]
  if (!item) return 0 // kilocode_change - Kilo drops opencode provider without apiKey/auth; lmstudio catalog models are all free
  return Object.values(item.models).filter((model) => model.cost.input > 0).length
}

const it = testEffect(LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node])))
const experimentalModels = testEffect(providerLayer({ enableExperimentalModels: true }))

const alphaProviderConfig = {
  provider: {
    "custom-provider": {
      name: "Custom Provider",
      npm: "@ai-sdk/openai-compatible",
      api: "https://api.custom.com/v1",
      models: {
        "active-model": {
          name: "Active Model",
        },
        "alpha-model": {
          name: "Alpha Model",
          status: "alpha" as const,
        },
      },
      options: {
        apiKey: "custom-key",
      },
    },
  },
}

// kilocode_change start - offline surface: built-in online providers (anthropic/openai/google/...) are cut from the catalog, so tests that used to rely on them configure a custom openai-compatible provider instead
const localModel = {
  name: "Qwen3 30B A3B",
  tool_call: true,
  reasoning: true,
  limit: { context: 40000, output: 8192 },
}
const lmstudioConfig = { enabled_providers: ["lmstudio"], provider: { lmstudio: { options: { apiKey: "lmstudio-key" } } } }
const lmstudioInstanceConfig = { config: lmstudioConfig }
const qwenModel = "qwen/qwen3-30b-a3b-2507"
// kilocode_change end

it.instance("provider loaded from env variable", () =>
  Effect.gen(function* () {
    yield* setProcessEnv("LMSTUDIO_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("lmstudio")]).toBeDefined()
    // Provider should retain its connection source even if custom loaders
    // merge additional options.
    expect(providers[ProviderV2.ID.make("lmstudio")].source).toBe("env")
  }),
)

it.instance(
  "provider loaded from config with apiKey option",
  Effect.gen(function* () {
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("lmstudio")]).toBeDefined()
  }),
  lmstudioInstanceConfig,
)

it.instance(
  "disabled_providers excludes provider",
  Effect.gen(function* () {
    yield* setProcessEnv("LMSTUDIO_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("lmstudio")]).toBeUndefined()
  }),
  { config: { disabled_providers: ["lmstudio"] } },
)

it.instance(
  "enabled_providers restricts to only listed providers",
  Effect.gen(function* () {
    yield* setProcessEnv("LMSTUDIO_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("lmstudio")]).toBeDefined()
  }),
  { config: { enabled_providers: ["lmstudio"] } },
)

it.instance(
  "model whitelist filters models for provider",
  Effect.gen(function* () {
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("lmstudio")]).toBeDefined()
    const models = Object.keys(providers[ProviderV2.ID.make("lmstudio")].models)
    expect(models).toContain(qwenModel)
    expect(models.length).toBe(1)
  }),
  { config: { enabled_providers: ["lmstudio"], provider: { lmstudio: { whitelist: [qwenModel] } } } },
)

it.instance(
  "model blacklist excludes specific models",
  Effect.gen(function* () {
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("lmstudio")]).toBeDefined()
    const models = Object.keys(providers[ProviderV2.ID.make("lmstudio")].models)
    expect(models).not.toContain(qwenModel)
  }),
  { config: { enabled_providers: ["lmstudio"], provider: { lmstudio: { blacklist: [qwenModel] } } } },
)

it.instance(
  "custom model alias via config",
  Effect.gen(function* () {
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("lmstudio")]).toBeDefined()
    expect(providers[ProviderV2.ID.make("lmstudio")].models["my-alias"]).toBeDefined()
    expect(providers[ProviderV2.ID.make("lmstudio")].models["my-alias"].name).toBe("My Custom Alias")
  }),
  {
    config: {
      enabled_providers: ["lmstudio"],
      provider: {
        lmstudio: { models: { "my-alias": { id: qwenModel, name: "My Custom Alias" } } },
      },
    },
  },
)

it.instance(
  "custom provider with npm package",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("custom-provider")]).toBeDefined()
    expect(providers[ProviderV2.ID.make("custom-provider")].name).toBe("Custom Provider")
    expect(providers[ProviderV2.ID.make("custom-provider")].models["custom-model"]).toBeDefined()
  }),
  {
    config: {
      provider: {
        "custom-provider": {
          name: "Custom Provider",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          env: ["CUSTOM_API_KEY"],
          models: {
            "custom-model": {
              name: "Custom Model",
              tool_call: true,
              limit: { context: 128000, output: 4096 },
            },
          },
          options: { apiKey: "custom-key" },
        },
      },
    },
  },
)

it.instance(
  "filters alpha provider models by default",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("custom-provider")].models["active-model"]).toBeDefined()
    expect(providers[ProviderV2.ID.make("custom-provider")].models["alpha-model"]).toBeUndefined()
  }),
  { config: alphaProviderConfig },
)

experimentalModels.instance(
  "includes alpha provider models when experimental models are enabled",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("custom-provider")].models["active-model"]).toBeDefined()
    expect(providers[ProviderV2.ID.make("custom-provider")].models["alpha-model"]).toBeDefined()
  }),
  { config: alphaProviderConfig },
)

it.instance(
  "custom DeepSeek openai-compatible model defaults interleaved reasoning field",
  Effect.gen(function* () {
    const providers = yield* list
    const provider = providers[ProviderV2.ID.make("custom-provider")]
    expect(provider.models["deepseek-r1"].capabilities.interleaved).toEqual({ field: "reasoning_content" })
    expect(provider.models["deepseek-details"].capabilities.interleaved).toEqual({ field: "reasoning_details" })
    expect(provider.models["deepseek-text"].capabilities.interleaved).toEqual({ field: "reasoning_text" })
    expect(provider.models["custom-reasoning"].capabilities.interleaved).toEqual({ field: "vendor_reasoning" })
    expect(provider.models["custom-model"].capabilities.interleaved).toBe(false)
    // kilocode_change - non-openai-compatible npm packages never get the deepseek default
    expect(providers[ProviderV2.ID.make("custom-anthropic-provider")].models["qwen/qwen3-30b-a3b-2507"].capabilities.interleaved).toBe(
      false,
    )
  }),
  {
    config: {
      provider: {
        "custom-provider": {
          name: "Custom Provider",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          models: {
            "deepseek-r1": { name: "DeepSeek R1" },
            "deepseek-details": { name: "DeepSeek Details", interleaved: { field: "reasoning_details" } },
            "deepseek-text": { name: "DeepSeek Text", interleaved: "reasoning_text" },
            "custom-reasoning": { name: "Custom Reasoning", interleaved: { field: "vendor_reasoning" } },
            "custom-model": { name: "Custom Model" },
          },
          options: { apiKey: "custom-key" },
        },
        "custom-anthropic-provider": {
          name: "Custom Anthropic Provider",
          npm: "@ai-sdk/anthropic",
          api: "https://api.custom.com/v1",
          models: { [qwenModel]: { name: "Qwen3 30B A3B" } },
          options: { apiKey: "custom-key" },
        },
      },
    },
  },
)

it.instance(
  "env variable takes precedence, config merges options",
  Effect.gen(function* () {
    yield* setProcessEnv("LMSTUDIO_API_KEY", "env-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("lmstudio")]).toBeDefined()
    // Config options should be merged
    expect(providers[ProviderV2.ID.make("lmstudio")].options.timeout).toBe(60000)
    expect(providers[ProviderV2.ID.make("lmstudio")].options.headerTimeout).toBe(10000)
    expect(providers[ProviderV2.ID.make("lmstudio")].options.chunkTimeout).toBe(15000)
  }),
  {
    config: {
      enabled_providers: ["lmstudio"],
      provider: { lmstudio: { options: { timeout: 60000, headerTimeout: 10000, chunkTimeout: 15000 } } },
    },
  },
)

it.instance("getModel returns model for valid provider/model", () =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const model = yield* provider.getModel(ProviderV2.ID.make("lmstudio"), ModelV2.ID.make(qwenModel))
    expect(model).toBeDefined()
    expect(String(model.providerID)).toBe("lmstudio")
    expect(String(model.id)).toBe(qwenModel)
    const language = yield* provider.getLanguage(model)
    expect(language).toBeDefined()
  }),
  lmstudioInstanceConfig,
)

it.instance("getModel throws ModelNotFoundError for invalid model", () =>
  Effect.gen(function* () {
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const exit = yield* Provider.use
      .getModel(ProviderV2.ID.make("lmstudio"), ModelV2.ID.make("nonexistent-model"))
      .pipe(Effect.exit)
    expect(exit._tag).toBe("Failure")
  }),
  lmstudioInstanceConfig,
)

it.instance("getModel throws ModelNotFoundError for invalid provider", () =>
  Effect.gen(function* () {
    const exit = yield* Provider.use
      .getModel(ProviderV2.ID.make("nonexistent-provider"), ModelV2.ID.make("some-model"))
      .pipe(Effect.exit)
    expect(exit._tag).toBe("Failure")
  }),
)

// Pure synchronous unit tests — no Effect runtime needed.

test("parseModel correctly parses provider/model string", () => {
  const result = Provider.parseModel("lmstudio/qwen/qwen3-30b-a3b-2507")
  expect(String(result.providerID)).toBe("lmstudio")
  expect(String(result.modelID)).toBe("qwen/qwen3-30b-a3b-2507")
})

test("parseModel handles model IDs with slashes", () => {
  const result = Provider.parseModel("custom-provider/anthropic/claude-3-opus")
  expect(String(result.providerID)).toBe("custom-provider")
  expect(String(result.modelID)).toBe("anthropic/claude-3-opus")
})

it.instance("defaultModel returns first available model when no config set", () =>
  Effect.gen(function* () {
    yield* setProcessEnv("LMSTUDIO_API_KEY", "test-api-key")
    const model = yield* Provider.use.defaultModel()
    expect(model.providerID).toBeDefined()
    expect(model.modelID).toBeDefined()
  }),
)

it.instance(
  "defaultModel respects config model setting",
  Effect.gen(function* () {
    const model = yield* Provider.use.defaultModel()
    expect(String(model.providerID)).toBe("lmstudio")
    expect(String(model.modelID)).toBe(qwenModel)
  }),
  { config: { model: `lmstudio/${qwenModel}` } },
)

it.instance(
  "defaultModel treats empty provider config as no allowlist",
  Effect.gen(function* () {
    yield* setProcessEnv("LMSTUDIO_API_KEY", "test-api-key")
    const model = yield* Provider.use.defaultModel()
    expect(model.providerID).toBeDefined()
    expect(model.modelID).toBeDefined()
  }),
  lmstudioInstanceConfig,
)

it.instance(
  "defaultModel returns a typed error when config excludes every provider",
  Effect.gen(function* () {
    const error = yield* Provider.use.defaultModel().pipe(Effect.flip)
    expect(error).toBeInstanceOf(Provider.NoProvidersError)
    expect(error._tag).toBe("ProviderNoProvidersError")
  }),
  { config: { enabled_providers: [] } },
)

it.instance(
  "provider with baseURL from config",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("custom-openai")]).toBeDefined()
    expect(providers[ProviderV2.ID.make("custom-openai")].options.baseURL).toBe("https://custom.openai.com/v1")
  }),
  {
    config: {
      provider: {
        "custom-openai": {
          name: "Custom OpenAI",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { "gpt-4": { name: "GPT-4", tool_call: true, limit: { context: 128000, output: 4096 } } },
          options: { apiKey: "test-key", baseURL: "https://custom.openai.com/v1" },
        },
      },
    },
  },
)

it.instance(
  "model cost defaults to zero when not specified",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("test-provider")].models["test-model"]
    expect(model.cost.input).toBe(0)
    expect(model.cost.output).toBe(0)
    expect(model.cost.cache.read).toBe(0)
    expect(model.cost.cache.write).toBe(0)
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { "test-model": { name: "Test Model", tool_call: true, limit: { context: 128000, output: 4096 } } },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "model options are merged from existing model",
  Effect.gen(function* () {
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("lmstudio")].models[qwenModel]
    expect(model.options.customOption).toBe("custom-value")
  }),
  {
    config: {
      enabled_providers: ["lmstudio"],
      provider: {
        lmstudio: {
          options: { apiKey: "test-api-key" },
          models: { [qwenModel]: { options: { customOption: "custom-value" } } },
        },
      },
    },
  },
)

it.instance(
  "provider removed when all models filtered out",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("lmstudio")]).toBeUndefined()
  }),
  {
    config: {
      enabled_providers: ["lmstudio"],
      provider: { lmstudio: { options: { apiKey: "test-api-key" }, whitelist: ["nonexistent-model"] } },
    },
  },
)

it.instance("closest finds model by partial match", () =>
  Effect.gen(function* () {
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const result = yield* Provider.use.closest(ProviderV2.ID.make("lmstudio"), ["qwen3-30b"])
    expect(result).toBeDefined()
    expect(String(result?.providerID)).toBe("lmstudio")
    expect(String(result?.modelID)).toContain("qwen3-30b")
  }),
  lmstudioInstanceConfig,
)

it.instance("closest returns undefined for nonexistent provider", () =>
  Effect.gen(function* () {
    const result = yield* Provider.use.closest(ProviderV2.ID.make("nonexistent"), ["model"])
    expect(result).toBeUndefined()
  }),
)

it.instance(
  "getModel uses realIdByKey for aliased models",
  Effect.gen(function* () {
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("lmstudio")].models["my-sonnet"]).toBeDefined()

    const model = yield* Provider.use.getModel(ProviderV2.ID.make("lmstudio"), ModelV2.ID.make("my-sonnet"))
    expect(model).toBeDefined()
    expect(String(model.id)).toBe("my-sonnet")
    expect(model.name).toBe("My Sonnet Alias")
  }),
  {
    config: {
      enabled_providers: ["lmstudio"],
      provider: {
        lmstudio: {
          models: { "my-sonnet": { id: qwenModel, name: "My Sonnet Alias" } },
        },
      },
    },
  },
)

it.instance(
  "provider api field sets model api.url",
  Effect.gen(function* () {
    const providers = yield* list
    // api field is stored on model.api.url, used by getSDK to set baseURL
    expect(providers[ProviderV2.ID.make("custom-api")].models["model-1"].api.url).toBe("https://api.example.com/v1")
  }),
  {
    config: {
      provider: {
        "custom-api": {
          name: "Custom API",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.example.com/v1",
          env: [],
          models: { "model-1": { name: "Model 1", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "explicit baseURL overrides api field",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("custom-api")].options.baseURL).toBe("https://custom.override.com/v1")
  }),
  {
    config: {
      provider: {
        "custom-api": {
          name: "Custom API",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.example.com/v1",
          env: [],
          models: { "model-1": { name: "Model 1", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { apiKey: "test-key", baseURL: "https://custom.override.com/v1" },
        },
      },
    },
  },
)

it.instance(
  "model inherits properties from existing database model",
  Effect.gen(function* () {
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("lmstudio")].models[qwenModel]
    expect(model.name).toBe("Custom Name for Sonnet")
    expect(model.capabilities.toolcall).toBe(true)
    expect(model.limit.context).toBeGreaterThan(0)
  }),
  {
    config: {
      enabled_providers: ["lmstudio"],
      provider: { lmstudio: { models: { [qwenModel]: { name: "Custom Name for Sonnet" } } } },
    },
  },
)

it.instance(
  "model config preserves explicitly empty models.dev variants",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("custom-gpt-provider")].models["custom-gpt-chat"]
    expect(model.name).toBe("Custom GPT Chat")
    expect(model.variants).toEqual({})
  }),
  {
    config: {
      provider: {
        "custom-gpt-provider": {
          name: "Custom GPT Provider",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          models: {
            "custom-gpt-chat": { id: "gpt-5-chat-latest", name: "Custom GPT Chat", variants: {} },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "model config regenerates variants when overriding the provider package",
  Effect.gen(function* () {
    yield* waitFor(hasProvider("custom-openai-provider"), "custom-openai-provider not loaded")
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("custom-openai-provider")].models["claude-via-openai"]
    // kilocode_change - @ai-sdk/openai npm generates reasoningEffort variants (low/medium/high) for reasoning models
    expect(model.variants?.low).toBeDefined()
    expect(model.variants?.high).toBeDefined()
  }),
  {
    config: {
      enabled_providers: ["custom-openai-provider"],
      provider: {
        "custom-openai-provider": {
          name: "Custom OpenAI Provider",
          npm: "@ai-sdk/openai",
          api: "https://api.custom.com/v1",
          models: { "claude-via-openai": { name: "Claude via OpenAI", reasoning: true } },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "disabled_providers prevents loading even with env var",
  Effect.gen(function* () {
    yield* set("LMSTUDIO_API_KEY", "test-lmstudio-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("lmstudio")]).toBeUndefined()
  }),
  { config: { disabled_providers: ["lmstudio"] } },
)

it.instance(
  "enabled_providers with empty array allows no providers",
  Effect.gen(function* () {
    yield* set("LMSTUDIO_API_KEY", "test-api-key")
    const providers = yield* list
    expect(Object.keys(providers).length).toBe(0)
  }),
  { config: { enabled_providers: [] } },
)

it.instance(
  "whitelist and blacklist can be combined",
  Effect.gen(function* () {
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("lmstudio")]).toBeDefined()
    const models = Object.keys(providers[ProviderV2.ID.make("lmstudio")].models)
    expect(models).toContain(qwenModel)
    expect(models).not.toContain("qwen/qwen3-coder-30b")
    expect(models.length).toBe(1)
  }),
  {
    config: {
      enabled_providers: ["lmstudio"],
      provider: {
        lmstudio: {
          whitelist: [qwenModel, "qwen/qwen3-coder-30b"],
          blacklist: ["qwen/qwen3-coder-30b"],
        },
      },
    },
  },
)

it.instance(
  "model modalities default correctly",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("test-provider")].models["test-model"]
    expect(model.capabilities.input.text).toBe(true)
    expect(model.capabilities.output.text).toBe(true)
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { "test-model": { name: "Test Model", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { apiKey: "test" },
        },
      },
    },
  },
)

it.instance(
  "model with custom cost values",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("test-provider")].models["test-model"]
    expect(model.cost.input).toBe(5)
    expect(model.cost.output).toBe(15)
    expect(model.cost.cache.read).toBe(2.5)
    expect(model.cost.cache.write).toBe(7.5)
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: {
            "test-model": {
              name: "Test Model",
              tool_call: true,
              limit: { context: 8000, output: 2000 },
              cost: { input: 5, output: 15, cache_read: 2.5, cache_write: 7.5 },
            },
          },
          options: { apiKey: "test" },
        },
      },
    },
  },
)

it.instance("getSmallModel returns appropriate small model", () =>
  Effect.gen(function* () {
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("lmstudio"))
    // kilocode_change - lmstudio catalog models carry no family metadata, so no small model is inferred
    expect(model).toBeUndefined()
  }),
  lmstudioInstanceConfig,
)

it.instance(
  "getSmallModel selects the latest model in the preferred family",
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model?.id).toBe(ModelV2.ID.make("newer-haiku"))
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "old-flash": { family: "gemini-flash", release_date: "2025-01-01" },
            "new-flash": { family: "gemini-flash", release_date: "2026-01-01" },
            "newer-haiku": { family: "claude-haiku", release_date: "2026-06-01" },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "getSmallModel matches exact model families",
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model?.id).toBe(ModelV2.ID.make("claude-haiku"))
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "glm-flash": { family: "glm-flash", release_date: "2026-06-01" },
            "claude-haiku": { family: "claude-haiku", release_date: "2026-01-01" },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  // kilocode_change start - without the Kilo gateway, a model lacking family metadata yields no small model
  "getSmallModel returns undefined when model IDs lack family metadata",
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model).toBeUndefined()
  }),
  // kilocode_change end
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "gpt-5-nano": { release_date: "2026-01-01" },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance("getSmallModel returns undefined for the unreachable azure provider", () =>
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.azure)
    expect(model).toBeUndefined()
  }),
)

it.instance("getSmallModel returns undefined for the unreachable azure-cognitive-services provider", () =>
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("azure-cognitive-services"))
    expect(model).toBeUndefined()
  }),
)

it.instance(
  "getSmallModel respects config small_model override",
  Effect.gen(function* () {
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("lmstudio"))
    expect(model).toBeDefined()
    expect(String(model?.providerID)).toBe("lmstudio")
    expect(String(model?.id)).toBe(qwenModel)
  }),
  { ...lmstudioConfig, config: { enabled_providers: ["lmstudio"], small_model: `lmstudio/${qwenModel}`, provider: lmstudioConfig.provider } },
)

it.instance(
  "getSmallModel ignores invalid config small_model",
  Effect.gen(function* () {
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("lmstudio"))
    expect(model).toBeUndefined()
  }),
  { config: { enabled_providers: ["lmstudio"], small_model: "lmstudio/not-a-real-model", provider: lmstudioConfig.provider } },
)

test("provider.sort prioritizes preferred models", () => {
  const models = [
    { id: "random-model", name: "Random" },
    { id: "claude-sonnet-4-latest", name: "Claude Sonnet 4" },
    { id: "gpt-5-turbo", name: "GPT-5 Turbo" },
    { id: "other-model", name: "Other" },
  ] as any[]

  const sorted = Provider.sort(models)
  expect(sorted[0].id).toContain("sonnet-4")
  expect(sorted[0].id).toContain("latest")
  expect(sorted[sorted.length - 1].id).not.toContain("gpt-5")
  expect(sorted[sorted.length - 1].id).not.toContain("sonnet-4")
})

it.instance(
  "multiple providers can be configured simultaneously",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("multi-a")]).toBeDefined()
    expect(providers[ProviderV2.ID.make("multi-b")]).toBeDefined()
    expect(providers[ProviderV2.ID.make("multi-a")].options.timeout).toBe(30000)
    expect(providers[ProviderV2.ID.make("multi-b")].options.timeout).toBe(60000)
  }),
  {
    config: {
      provider: {
        "multi-a": {
          name: "Multi A",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { model: { ...localModel } },
          options: { apiKey: "key", timeout: 30000 },
        },
        "multi-b": {
          name: "Multi B",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { model: { ...localModel } },
          options: { apiKey: "key", timeout: 60000 },
        },
      },
    },
  },
)

it.instance(
  "provider with custom npm package",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("local-llm")]).toBeDefined()
    expect(providers[ProviderV2.ID.make("local-llm")].models["llama-3"].api.npm).toBe("@ai-sdk/openai-compatible")
    expect(providers[ProviderV2.ID.make("local-llm")].options.baseURL).toBe("http://localhost:11434/v1")
  }),
  {
    config: {
      provider: {
        "local-llm": {
          name: "Local LLM",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { "llama-3": { name: "Llama 3", tool_call: true, limit: { context: 8192, output: 2048 } } },
          options: { apiKey: "not-needed", baseURL: "http://localhost:11434/v1" },
        },
      },
    },
  },
)

// Edge cases for model configuration

it.instance(
  "model alias name defaults to alias key when id differs",
  Effect.gen(function* () {
    yield* waitFor(hasProvider("lmstudio"), "lmstudio provider not loaded")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("lmstudio")].models["sonnet"].name).toBe("sonnet")
  }),
  {
    config: {
      enabled_providers: ["lmstudio"],
      provider: {
        lmstudio: {
          models: { sonnet: { id: qwenModel } },
        },
      },
    },
  },
)

it.instance(
  "provider with multiple env var options only includes apiKey when single env",
  Effect.gen(function* () {
    yield* set("MULTI_ENV_KEY_1", "test-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("multi-env")]).toBeDefined()
    // When multiple env options exist, key should NOT be auto-set
    expect(providers[ProviderV2.ID.make("multi-env")].key).toBeUndefined()
  }),
  {
    config: {
      provider: {
        "multi-env": {
          name: "Multi Env Provider",
          npm: "@ai-sdk/openai-compatible",
          env: ["MULTI_ENV_KEY_1", "MULTI_ENV_KEY_2"],
          models: { "model-1": { name: "Model 1", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { baseURL: "https://api.example.com/v1" },
        },
      },
    },
  },
)

it.instance(
  "provider with single env var includes apiKey automatically",
  Effect.gen(function* () {
    yield* set("SINGLE_ENV_KEY", "my-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("single-env")]).toBeDefined()
    // Single env option should auto-set key
    expect(providers[ProviderV2.ID.make("single-env")].key).toBe("my-api-key")
  }),
  {
    config: {
      provider: {
        "single-env": {
          name: "Single Env Provider",
          npm: "@ai-sdk/openai-compatible",
          env: ["SINGLE_ENV_KEY"],
          models: { "model-1": { name: "Model 1", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { baseURL: "https://api.example.com/v1" },
        },
      },
    },
  },
)

it.instance(
  "model cost overrides existing cost values",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("lmstudio")].models[qwenModel]
    expect(model.cost.input).toBe(999)
    expect(model.cost.output).toBe(888)
  }),
  {
    config: {
      provider: {
        lmstudio: {
          models: { [qwenModel]: { cost: { input: 999, output: 888 } } },
        },
      },
    },
  },
)

it.instance(
  "completely new provider not in database can be configured",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("brand-new-provider")]).toBeDefined()
    expect(providers[ProviderV2.ID.make("brand-new-provider")].name).toBe("Brand New")
    const model = providers[ProviderV2.ID.make("brand-new-provider")].models["new-model"]
    expect(model.capabilities.reasoning).toBe(true)
    expect(model.capabilities.attachment).toBe(true)
    expect(model.capabilities.input.image).toBe(true)
  }),
  {
    config: {
      provider: {
        "brand-new-provider": {
          name: "Brand New",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          api: "https://new-api.com/v1",
          models: {
            "new-model": {
              name: "New Model",
              tool_call: true,
              reasoning: true,
              attachment: true,
              temperature: true,
              limit: { context: 32000, output: 8000 },
              modalities: { input: ["text", "image"], output: ["text"] },
            },
          },
          options: { apiKey: "new-key" },
        },
      },
    },
  },
)

it.instance(
  "disabled_providers and enabled_providers interaction",
  Effect.gen(function* () {
    yield* set("LMSTUDIO_API_KEY", "test-lmstudio")
    const providers = yield* list
    // lmstudio: in enabled, not in disabled = allowed
    expect(providers[ProviderV2.ID.make("lmstudio")]).toBeDefined()
    // atomic-chat: in enabled, but also in disabled = NOT allowed
    expect(providers[ProviderV2.ID.make("atomic-chat")]).toBeUndefined()
    // privatemode-ai: not in enabled = NOT allowed (even though not disabled)
    expect(providers[ProviderV2.ID.make("privatemode-ai")]).toBeUndefined()
  }),
  {
    // enabled_providers takes precedence — only these are considered
    // Then disabled_providers filters from the enabled set
    config: { enabled_providers: ["lmstudio", "atomic-chat"], disabled_providers: ["atomic-chat"] },
  },
)

it.instance(
  "model with tool_call false",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("no-tools")].models["basic-model"].capabilities.toolcall).toBe(false)
  }),
  {
    config: {
      provider: {
        "no-tools": {
          name: "No Tools Provider",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { "basic-model": { name: "Basic Model", tool_call: false, limit: { context: 4000, output: 1000 } } },
          options: { apiKey: "test" },
        },
      },
    },
  },
)

it.instance(
  "model defaults tool_call to true when not specified",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("default-tools")].models["model"].capabilities.toolcall).toBe(true)
  }),
  {
    config: {
      provider: {
        "default-tools": {
          name: "Default Tools Provider",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { model: { name: "Model", limit: { context: 4000, output: 1000 } } },
          options: { apiKey: "test" },
        },
      },
    },
  },
)

it.instance(
  "model headers are preserved",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("headers-provider")].models["model"]
    expect(model.headers).toEqual({
      "X-Custom-Header": "custom-value",
      Authorization: "Bearer special-token",
    })
  }),
  {
    config: {
      provider: {
        "headers-provider": {
          name: "Headers Provider",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: {
            model: {
              name: "Model",
              tool_call: true,
              limit: { context: 4000, output: 1000 },
              headers: { "X-Custom-Header": "custom-value", Authorization: "Bearer special-token" },
            },
          },
          options: { apiKey: "test" },
        },
      },
    },
  },
)

it.instance(
  "provider env fallback - second env var used if first missing",
  Effect.gen(function* () {
    // Only set fallback, not primary
    yield* set("FALLBACK_KEY", "fallback-api-key")
    const providers = yield* list
    // Provider should load because fallback env var is set
    expect(providers[ProviderV2.ID.make("fallback-env")]).toBeDefined()
  }),
  {
    config: {
      provider: {
        "fallback-env": {
          name: "Fallback Env Provider",
          npm: "@ai-sdk/openai-compatible",
          env: ["PRIMARY_KEY", "FALLBACK_KEY"],
          models: { model: { name: "Model", tool_call: true, limit: { context: 4000, output: 1000 } } },
          options: { baseURL: "https://api.example.com" },
        },
      },
    },
  },
)

it.instance("getModel returns consistent results", () =>
  Effect.gen(function* () {
    const model1 = yield* Provider.use.getModel(ProviderV2.ID.make("lmstudio"), ModelV2.ID.make(qwenModel))
    const model2 = yield* Provider.use.getModel(ProviderV2.ID.make("lmstudio"), ModelV2.ID.make(qwenModel))
    expect(model1.providerID).toEqual(model2.providerID)
    expect(model1.id).toEqual(model2.id)
    expect(model1).toEqual(model2)
  }),
  lmstudioInstanceConfig,
)

it.instance(
  "provider name defaults to id when not in database",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("my-custom-id")].name).toBe("my-custom-id")
  }),
  {
    config: {
      provider: {
        "my-custom-id": {
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { model: { name: "Model", tool_call: true, limit: { context: 4000, output: 1000 } } },
          options: { apiKey: "test" },
        },
      },
    },
  },
)

it.instance("ModelNotFoundError includes suggestions for typos", () =>
  Effect.gen(function* () {
    const error = yield* Provider.use
      .getModel(ProviderV2.ID.make("lmstudio"), ModelV2.ID.make("qwen/qwen3-30b-fake"))
      .pipe(Effect.flip)
    expect(error.suggestions).toBeDefined()
    expect((error.suggestions ?? []).length).toBeGreaterThan(0)
    expect(error.message).toContain("Model not found: lmstudio/qwen/qwen3-30b-fake")
    expect(error.message).toContain("Did you mean:")
  }),
)

it.instance("ModelNotFoundError for provider includes suggestions", () =>
  Effect.gen(function* () {
    const error = yield* Provider.use
      .getModel(ProviderV2.ID.make("lmstud"), ModelV2.ID.make(qwenModel))
      .pipe(Effect.flip)
    expect(error.suggestions).toBeDefined()
    expect(error.suggestions).toContain("lmstudio")
  }),
  lmstudioInstanceConfig,
)

it.instance("models for providers cut from the offline catalog are not suggested", () =>
  Effect.gen(function* () {
    yield* remove("OPENCODE_API_KEY")
    // kilocode_change - the opencode provider (free-tier gate) is cut from the offline catalog, so it no longer contributes models to suggestions
    const error = yield* Provider.use
      .getModel(ProviderV2.ID.make("lmstudio"), ModelV2.ID.make("claude-haiku-fake-model"))
      .pipe(Effect.flip)
    if (!Provider.ModelNotFoundError.isInstance(error)) throw error
    expect(error.suggestions ?? []).not.toContain("claude-haiku-4-5")
  }),
)

it.instance("getProvider returns undefined for nonexistent provider", () =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service.use((svc) => svc.getProvider(ProviderV2.ID.make("nonexistent")))
    expect(provider).toBeUndefined()
  }),
)

it.instance("getProvider returns provider info", () =>
  Effect.gen(function* () {
    const provider = yield* Provider.use.getProvider(ProviderV2.ID.make("lmstudio"))
    expect(provider).toBeDefined()
    expect(String(provider?.id)).toBe("lmstudio")
  }),
  lmstudioInstanceConfig,
)

it.instance("closest returns undefined when no partial match found", () =>
  Effect.gen(function* () {
    const result = yield* Provider.use.closest(ProviderV2.ID.make("lmstudio"), ["nonexistent-xyz-model"])
    expect(result).toBeUndefined()
  }),
)

it.instance("closest checks multiple query terms in order", () =>
  Effect.gen(function* () {
    // First term won't match, second will (qwen3-coder-30b is in the lmstudio catalog)
    const result = yield* Provider.use.closest(ProviderV2.ID.make("lmstudio"), ["nonexistent", "qwen3-coder-30b"])
    expect(result).toBeDefined()
    expect(String(result?.modelID)).toContain("qwen3-coder-30b")
  }),
  lmstudioInstanceConfig,
)

it.instance(
  "model limit defaults to zero when not specified",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("no-limit")].models["model"]
    expect(model.limit.context).toBe(0)
    expect(model.limit.output).toBe(0)
  }),
  {
    config: {
      provider: {
        "no-limit": {
          name: "No Limit Provider",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { model: { name: "Model", tool_call: true } },
          options: { apiKey: "test" },
        },
      },
    },
  },
)

it.instance(
  "provider options are deeply merged",
  Effect.gen(function* () {
    const providers = yield* list
    // Custom options should be merged
    expect(providers[ProviderV2.ID.make("lmstudio")].options.timeout).toBe(30000)
    expect(providers[ProviderV2.ID.make("lmstudio")].options.headers["X-Custom"]).toBe("custom-value")
    // provider custom loader adds its own headers, they should coexist
    expect(providers[ProviderV2.ID.make("lmstudio")].options.apiKey).toBe("test-api-key")
  }),
  {
    config: {
      provider: { lmstudio: { options: { apiKey: "test-api-key", headers: { "X-Custom": "custom-value" }, timeout: 30000 } } },
    },
  },
)

// kilocode_change - the built-in nvidia loader (which injected X-BILLING-INVOKE-ORIGIN / branding headers) was removed with the online catalog cut; custom openai-compatible providers carry only user-supplied headers, so these cases no longer have a subject to exercise.

it.instance(
  "custom model inherits npm package from models.dev provider config",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("custom-openai-npm")].models["my-custom-model"]
    expect(model).toBeDefined()
    expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
  }),
  {
    config: {
      provider: {
        "custom-openai-npm": {
          name: "Custom OpenAI NPM",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          models: {
            "my-custom-model": {
              name: "My Custom Model",
              tool_call: true,
              limit: { context: 8000, output: 2000 },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "custom model inherits api.url from models.dev provider",
  Effect.gen(function* () {
    const providers = yield* list
    // New model not in database should inherit api.url from provider
    const intellect = providers[ProviderV2.ID.make("custom-inherit")].models["prime-intellect/intellect-3"]
    expect(intellect).toBeDefined()
    expect(intellect.api.url).toBe("https://api.custom.com/v1")

    // Another new model should also inherit api.url
    const deepseek = providers[ProviderV2.ID.make("custom-inherit")].models["deepseek/deepseek-r1-0528"]
    expect(deepseek).toBeDefined()
    expect(deepseek.api.url).toBe("https://api.custom.com/v1")
    expect(deepseek.name).toBe("DeepSeek R1")
  }),
  {
    config: {
      provider: {
        "custom-inherit": {
          name: "Custom Inherit",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          models: {
            "prime-intellect/intellect-3": {},
            "deepseek/deepseek-r1-0528": { name: "DeepSeek R1" },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

test("mode options and cost are derived from the base model", () => {
  const provider = {
    id: "openai",
    name: "OpenAI",
    env: [],
    npm: "@ai-sdk/openai",
    api: "https://api.openai.com/v1",
    models: {
      "gpt-5.6-sol": {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        family: "gpt",
        release_date: "2026-03-05",
        attachment: true,
        reasoning: true,
        temperature: false,
        tool_call: true,
        cost: {
          input: 2.5,
          output: 15,
          cache_read: 0.25,
          context_over_200k: {
            input: 5,
            output: 22.5,
            cache_read: 0.5,
          },
        },
        limit: {
          context: 1_050_000,
          input: 922_000,
          output: 128_000,
        },
        experimental: {
          modes: {
            fast: {
              cost: {
                input: 5,
                output: 30,
                cache_read: 0.5,
              },
              provider: {
                body: {
                  service_tier: "priority",
                },
              },
            },
            pro: {
              provider: {
                body: {
                  reasoning: { mode: "pro" },
                  service_tier: "priority",
                },
              },
            },
          },
        },
      },
    },
  } as unknown as ModelsDev.Provider

  const model = Provider.fromModelsDevProvider(provider).models["gpt-5.6-sol-fast"]
  expect(model.cost.input).toEqual(5)
  expect(model.cost.output).toEqual(30)
  expect(model.cost.cache.read).toEqual(0.5)
  expect(model.cost.cache.write).toEqual(0)
  expect(model.options["serviceTier"]).toEqual("priority")
  const pro = Provider.fromModelsDevProvider(provider).models["gpt-5.6-sol-pro"]
  expect(pro.api.id).toEqual("gpt-5.6-sol")
  expect(pro.options).toEqual({ reasoningMode: "pro", serviceTier: "priority" })
  expect(model.cost.experimentalOver200K).toEqual({
    input: 5,
    output: 22.5,
    cache: { read: 0.5, write: 0 },
  })
})

test("models.dev normalization fills required response fields", () => {
  const provider = {
    id: "gateway",
    name: "Gateway",
    env: [],
    models: {
      "gpt-5.4": {
        id: "gpt-5.4",
        name: "GPT-5.4",
        family: "gpt",
        interleaved: "reasoning_text",
        cost: { input: 2.5, output: 15 },
        limit: { context: 1_050_000, input: 922_000, output: 128_000 },
      },
    },
  } as unknown as ModelsDev.Provider

  const model = Provider.fromModelsDevProvider(provider).models["gpt-5.4"]
  expect(model.api.url).toBe("")
  expect(model.capabilities.temperature).toBe(false)
  expect(model.capabilities.reasoning).toBe(false)
  expect(model.capabilities.attachment).toBe(false)
  expect(model.capabilities.toolcall).toBe(true)
  expect(model.capabilities.interleaved).toEqual({ field: "reasoning_text" })
  expect(model.release_date).toBe("")
})

test("models.dev reasoning options replace generated variants and unsupported toggles fall back", () => {
  const provider = {
    id: "reasoning",
    name: "Reasoning",
    env: [],
    npm: "@ai-sdk/openai",
    models: {
      explicit: {
        id: "gpt-5.4",
        name: "Explicit",
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["low"] }],
        limit: { context: 128_000, output: 64_000 },
      },
      empty: {
        id: "gpt-5.4",
        name: "Empty",
        reasoning: true,
        reasoning_options: [],
        limit: { context: 128_000, output: 64_000 },
      },
      fallback: {
        id: "gpt-5.4",
        name: "Fallback",
        reasoning: true,
        reasoning_options: [{ type: "toggle" }],
        limit: { context: 128_000, output: 64_000 },
      },
      override: {
        id: "gemini-3-pro",
        name: "Override",
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["high"] }],
        provider: { npm: "@ai-sdk/google" },
        limit: { context: 128_000, output: 64_000 },
        experimental: { modes: { fast: {} } },
      },
      anthropicCompatible: {
        id: "k3",
        name: "Anthropic Compatible",
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["max"] }],
        provider: { npm: "@ai-sdk/anthropic" },
        limit: { context: 1_048_576, output: 131_072 },
      },
    },
  } as unknown as ModelsDev.Provider

  const models = Provider.fromModelsDevProvider(provider).models
  expect(models.explicit.variants).toEqual({
    low: {
      reasoningEffort: "low",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    },
  })
  expect(models.empty.variants).toEqual({})
  expect(Object.keys(models.fallback.variants ?? {})).toEqual(["none", "low", "medium", "high", "xhigh"])
  expect(models.override.variants).toEqual({
    high: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
  })
  expect(models.anthropicCompatible.variants).toEqual({ max: { effort: "max" } })
  expect(models["gemini-3-pro-fast"].variants).toEqual(models.override.variants)
})

test("public provider info omits invalid models", () => {
  const provider = Provider.fromModelsDevProvider({
    id: "test",
    name: "Test",
    env: [],
    models: {
      valid: {
        id: "valid",
        name: "Valid",
        cost: { input: 1, output: 1 },
        limit: { context: 128_000, output: 16_000 },
      },
    },
  } as unknown as ModelsDev.Provider)
  provider.models.invalid = {
    ...provider.models.valid,
    id: ModelV2.ID.make("invalid"),
    cost: { ...provider.models.valid.cost, input: Number.NaN },
  }

  const result = Provider.toPublicInfo(provider)

  expect(result.models.valid).toBeDefined()
  expect(result.models.invalid).toBeUndefined()
})

it.instance(
  "model variants are generated for reasoning models",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("custom-reasoning-gen")].models["reasoning-model"]
    // kilocode_change - lmstudio catalog models carry no reasoning metadata; a custom openai-compatible provider exercises variant generation
    expect(model.capabilities.reasoning).toBe(true)
    expect(model.variants).toBeDefined()
    expect(Object.keys(model.variants!).length).toBeGreaterThan(0)
  }),
  {
    config: {
      provider: {
        "custom-reasoning-gen": {
          name: "Custom Reasoning Gen",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          models: {
            "reasoning-model": {
              name: "Reasoning Model",
              tool_call: true,
              reasoning: true,
              limit: { context: 32000, output: 4096 },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "model variants can be disabled via config",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("custom-variants")].models["reasoning-model"]
    expect(model.variants).toBeDefined()
    expect(model.variants!["high"]).toBeUndefined()
    // Other variants should still exist
    expect(model.variants!["low"]).toBeDefined()
  }),
  {
    config: {
      provider: {
        "custom-variants": {
          name: "Custom Variants",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          models: {
            "reasoning-model": {
              name: "Reasoning Model",
              tool_call: true,
              reasoning: true,
              limit: { context: 32000, output: 4096 },
              variants: { high: { disabled: true } },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "model variants can be customized via config",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("custom-variants")].models["reasoning-model"]
    expect(model.variants!["high"]).toBeDefined()
    expect(model.variants!["high"].extraOption).toBe("custom-value")
  }),
  {
    config: {
      provider: {
        "custom-variants": {
          name: "Custom Variants",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          models: {
            "reasoning-model": {
              name: "Reasoning Model",
              tool_call: true,
              reasoning: true,
              limit: { context: 32000, output: 4096 },
              variants: { high: { extraOption: "custom-value" } },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "disabled key is stripped from variant config",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("custom-reasoning")].models["reasoning-model"]
    expect(model.variants!["low"]).toBeDefined()
    expect(model.variants!["low"].disabled).toBeUndefined()
    expect(model.variants!["low"].customField).toBe("test")
  }),
  {
    config: {
      provider: {
        "custom-reasoning": {
          name: "Custom Reasoning Provider",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: {
            "reasoning-model": {
              name: "Reasoning Model",
              tool_call: true,
              reasoning: true,
              limit: { context: 128000, output: 16000 },
              variants: { low: { customField: "test", disabled: false } },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "all variants can be disabled via config",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("custom-variants")].models["reasoning-model"]
    expect(model.variants).toBeDefined()
    expect(Object.keys(model.variants!).length).toBe(0)
  }),
  {
    config: {
      provider: {
        "custom-variants": {
          name: "Custom Variants",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          models: {
            "reasoning-model": {
              name: "Reasoning Model",
              tool_call: true,
              reasoning: true,
              limit: { context: 32000, output: 4096 },
              variants: {
                low: { disabled: true },
                medium: { disabled: true },
                high: { disabled: true },
              },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "configured variants remain authoritative", // kilocode_change
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("custom-variants")].models["reasoning-model"]
    expect(model.variants!["high"]).toBeDefined()
    expect(model.variants!["high"].reasoningEffort).toBeUndefined() // kilocode_change
    expect(model.variants!["high"].extraOption).toBe("custom-value")
  }),
  {
    config: {
      provider: {
        "custom-variants": {
          name: "Custom Variants",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          models: {
            "reasoning-model": {
              name: "Reasoning Model",
              tool_call: true,
              reasoning: true,
              limit: { context: 32000, output: 4096 },
              variants: { high: { extraOption: "custom-value" } },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "variants filtered in second pass for database models",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("custom-variants")].models["reasoning-model"]
    expect(model.variants).toBeDefined()
    expect(model.variants!["high"]).toBeUndefined()
    // Other variants should still exist
    expect(model.variants!["low"]).toBeDefined()
  }),
  {
    config: {
      provider: {
        "custom-variants": {
          name: "Custom Variants",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          models: {
            "reasoning-model": {
              name: "Reasoning Model",
              tool_call: true,
              reasoning: true,
              limit: { context: 32000, output: 4096 },
              variants: { high: { disabled: true } },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "custom model with variants enabled and disabled",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.make("custom-reasoning")].models["reasoning-model"]
    expect(model.variants).toBeDefined()
    // Enabled variants should exist
    expect(model.variants!["low"]).toBeDefined()
    expect(model.variants!["low"].reasoningEffort).toBe("low")
    expect(model.variants!["medium"]).toBeDefined()
    expect(model.variants!["medium"].reasoningEffort).toBe("medium")
    expect(model.variants!["custom"]).toBeDefined()
    expect(model.variants!["custom"].reasoningEffort).toBe("custom")
    expect(model.variants!["custom"].budgetTokens).toBe(5000)
    // Disabled variant should not exist
    expect(model.variants!["high"]).toBeUndefined()
    // disabled key should be stripped from all variants
    expect(model.variants!["low"].disabled).toBeUndefined()
    expect(model.variants!["medium"].disabled).toBeUndefined()
    expect(model.variants!["custom"].disabled).toBeUndefined()
  }),
  {
    config: {
      provider: {
        "custom-reasoning": {
          name: "Custom Reasoning Provider",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: {
            "reasoning-model": {
              name: "Reasoning Model",
              tool_call: true,
              reasoning: true,
              limit: { context: 128000, output: 16000 },
              variants: {
                low: { reasoningEffort: "low" },
                medium: { reasoningEffort: "medium" },
                high: { reasoningEffort: "high", disabled: true },
                custom: { reasoningEffort: "custom", budgetTokens: 5000 },
              },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

// kilocode_change - google-vertex / cloudflare-ai-gateway are cut from the offline catalog; their online endpoint behavior is no longer testable here

it.instance("cloudflare-ai-gateway forwards config metadata options", () =>
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.make("custom-cf-gateway")]).toBeDefined()
    expect(providers[ProviderV2.ID.make("custom-cf-gateway")].options.metadata).toEqual({
      invoked_by: "test",
      project: "opencode",
    })
  }),
  {
    config: {
      provider: {
        "custom-cf-gateway": {
          name: "Custom CF Gateway",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.com/v1",
          models: { model: { ...localModel } },
          options: { apiKey: "test-token", metadata: { invoked_by: "test", project: "opencode" } },
        },
      },
    },
  },
)

// Tests that need plugin file setup or multi-instance flows fall back to a
// scoped tmpdir + provideInstance pattern via it.effect.

const instanceStoreLayer = LayerNode.compile(InstanceStore.node, [
  [InstanceStore.bootstrapNode, InstanceBootstrap.node],
])
const provideMultiInstance = <A, E, R>(eff: Effect.Effect<A, E, R>) =>
  eff.pipe(Effect.provide(instanceStoreLayer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node)))

it.effect("plugin config providers persist after instance dispose", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const configDir = path.join(dir, ".kilo") // kilocode_change
    const root = path.join(configDir, "plugin")
    yield* Effect.promise(() => mkdir(root, { recursive: true }))
    yield* Effect.promise(() => markPluginDependenciesReady(configDir))
    yield* Effect.promise(() => markPluginDependenciesReady(Global.Path.config))
    yield* Effect.promise(() =>
      Bun.write(
        path.join(root, "demo-provider.ts"),
        [
          "export default {",
          '  id: "demo.plugin-provider",',
          "  server: async () => ({",
          "    async config(cfg) {",
          "      cfg.provider ??= {}",
          "      cfg.provider.demo = {",
          '        name: "Demo Provider",',
          '        npm: "@ai-sdk/openai-compatible",',
          '        api: "https://example.com/v1",',
          "        models: {",
          "          chat: {",
          '            name: "Demo Chat",',
          "            tool_call: true,",
          "            limit: { context: 128000, output: 4096 },",
          "          },",
          "        },",
          "      }",
          "    },",
          "  }),",
          "}",
          "",
        ].join("\n"),
      ),
    )

    const loadAndList = Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const provider = yield* Provider.Service
      yield* plugin.init()
      return yield* provider.list()
    }).pipe(provideInstanceEffect(dir))

    const first = yield* loadAndList
    expect(first[ProviderV2.ID.make("demo")]).toBeDefined()
    expect(first[ProviderV2.ID.make("demo")].models[ModelV2.ID.make("chat")]).toBeDefined()

    yield* Effect.promise(() => disposeAllInstances())

    const second = yield* loadAndList
    expect(second[ProviderV2.ID.make("demo")]).toBeDefined()
    expect(second[ProviderV2.ID.make("demo")].models[ModelV2.ID.make("chat")]).toBeDefined()
  }).pipe(provideMultiInstance),
)

it.instance(
  "plugin config enabled and disabled providers are honored",
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const configDir = path.join(instance.directory, ".kilo") // kilocode_change
    const root = path.join(configDir, "plugin")
    yield* Effect.promise(() => mkdir(root, { recursive: true }))
    yield* Effect.promise(() => markPluginDependenciesReady(configDir))
    yield* Effect.promise(() => markPluginDependenciesReady(Global.Path.config)) // kilocode_change
    yield* Effect.promise(() =>
      Bun.write(
        path.join(root, "provider-filter.ts"),
[
            "export default {",
            '  id: "demo.provider-filter",',
            "  server: async () => ({",
            "    async config(cfg) {",
            '      cfg.enabled_providers = ["lmstudio"]',
            '      cfg.disabled_providers = ["lmstudio"]',
            "    },",
            "  }),",
            "}",
            "",
          ].join("\n"),
      ),
    )

    const providers = yield* list
    expect(providers[ProviderV2.ID.make("lmstudio")]).toBeUndefined()
  }),
)

it.effect("opencode loader keeps paid models when config apiKey is present", () =>
  Effect.gen(function* () {
    const noneDir = yield* tmpdirScoped()
    const keyedDir = yield* tmpdirScoped({
      config: { provider: { opencode: { options: { apiKey: "test-key" } } } },
    })

    const listIn = (directory: string) =>
      Provider.use
        .list()
        .pipe(provideInstanceEffect(directory))
        .pipe(Effect.provide(instanceStoreLayer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node)))

    const none = paid(yield* listIn(noneDir))
    const keyedCount = paid(yield* listIn(keyedDir))

    // kilocode_change - the opencode provider (free-tier gate) is cut from the offline catalog, so both surfaces report no paid models
    expect(none).toBe(0)
    expect(keyedCount).toBe(0)
  }).pipe(provideMultiInstance),
)

it.effect("opencode loader keeps paid models when auth exists", () =>
  Effect.gen(function* () {
    const noneDir = yield* tmpdirScoped()
    const keyedDir = yield* tmpdirScoped()

    const listIn = (directory: string) =>
      Provider.use
        .list()
        .pipe(provideInstanceEffect(directory))
        .pipe(Effect.provide(instanceStoreLayer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node)))

    const none = paid(yield* listIn(noneDir))

    const authPath = path.join(Global.Path.data, "auth.json")
    const original = yield* Effect.promise(() => Filesystem.readText(authPath).catch(() => undefined))

    yield* Effect.acquireRelease(
      Effect.promise(() => Filesystem.write(authPath, JSON.stringify({ opencode: { type: "api", key: "test-key" } }))),
      () =>
        Effect.promise(async () => {
          if (original !== undefined) await Filesystem.write(authPath, original)
          else await unlink(authPath).catch(() => undefined)
        }),
    )

    const keyedCount = paid(yield* listIn(keyedDir))

    // kilocode_change - the opencode provider (free-tier gate) is cut from the offline catalog, so both surfaces report no paid models
    expect(none).toBe(0)
    expect(keyedCount).toBe(0)
  }).pipe(provideMultiInstance),
)
