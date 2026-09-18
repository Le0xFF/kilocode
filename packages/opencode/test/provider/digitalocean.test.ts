import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Provider } from "../../src/provider/provider"

import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"

const DO = ProviderV2.ID.make("do-local")
const it = testEffect(LayerNode.compile(Provider.node))

// kilocode_change start - the built-in digitalocean provider (env autoload + base-model passthrough) was removed with the online catalog cut; these tests exercise a custom openai-compatible provider declared in config instead
it.instance(
  "custom do-like provider loads from config",
  () =>
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      const providers = yield* provider.list()
      expect(providers[DO]).toBeDefined()
      expect(providers[DO].source).toBe("config")
      const baseModel = Object.values(providers[DO].models)[0]
      expect(baseModel.api.url).toBe("https://inference.do-ai.run/v1")
      expect(baseModel.api.npm).toBe("@ai-sdk/openai-compatible")
    }),
  {
    config: {
      provider: {
        "do-local": {
          name: "DO Local",
          npm: "@ai-sdk/openai-compatible",
          api: "https://inference.do-ai.run/v1",
          models: { model: { name: "Model", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { apiKey: "test-token" },
        },
      },
    },
  },
)

it.instance(
  "custom do-like provider passes through its configured models",
  () =>
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      const providers = yield* provider.list()
      const models = providers[DO].models
      expect(Object.keys(models).length).toBeGreaterThan(0)
    }),
  {
    config: {
      provider: {
        "do-local": {
          name: "DO Local",
          npm: "@ai-sdk/openai-compatible",
          api: "https://inference.do-ai.run/v1",
          models: { model: { name: "Model", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { apiKey: "test-token" },
        },
      },
    },
  },
)
// kilocode_change end