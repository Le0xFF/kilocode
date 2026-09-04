import { afterEach, describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import path from "path"
import { unlink } from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"
import { Env } from "../../src/env"
import { Provider } from "@/provider/provider"

import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const it = testEffect(LayerNode.compile(LayerNode.group([Provider.node, Env.node])))

const originalEnv = new Map<string, string | undefined>()

const set = (k: string, v: string) =>
  Effect.gen(function* () {
    if (!originalEnv.has(k)) originalEnv.set(k, process.env[k])
    process.env[k] = v
    yield* Env.use.set(k, v)
  })

afterEach(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  originalEnv.clear()
  await disposeAllInstances()
})

const list = Provider.use.list()

const withAuthJson = (contents: string) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const authPath = path.join(Global.Path.data, "auth.json")
      let original: string | undefined
      try {
        original = await Filesystem.readText(authPath)
      } catch {
        original = undefined
      }
      await Filesystem.write(authPath, contents)
      return { authPath, original }
    }),
    ({ authPath, original }) =>
      Effect.promise(async () => {
        if (original !== undefined) {
          await Filesystem.write(authPath, original)
          return
        }
        await unlink(authPath).catch(() => undefined)
      }),
  )

// kilocode_change start - the built-in amazon-bedrock provider was removed with the online catalog cut; these tests exercise a custom openai-compatible provider instead
it.instance(
  "custom bedrock-like provider: config options take precedence over env vars",
  () =>
    Effect.gen(function* () {
      yield* set("AWS_REGION", "us-east-1")
      const providers = yield* list
      const provider = providers[ProviderV2.ID.make("bedrock-local")]
      expect(provider).toBeDefined()
      expect(provider.options?.region).toBe("eu-west-1")
    }),
  { config: { provider: { "bedrock-local": { name: "Bedrock Local", npm: "@ai-sdk/openai-compatible", api: "https://bedrock.example.com/v1", models: { model: { name: "Model", tool_call: true, limit: { context: 8000, output: 2000 } } }, options: { apiKey: "test-key", region: "eu-west-1" } } } } },
)

it.instance(
  "custom bedrock-like provider: loads when bearer token from auth.json is present",
  () =>
    Effect.gen(function* () {
      yield* withAuthJson(JSON.stringify({ "bedrock-local": { type: "api", key: "test-bearer-token" } }))
      const providers = yield* list
      // kilocode_change - a custom openai-compatible provider declared in config that also has an API-key credential in auth.json loads; the config re-pass stamps source "config" while the credential key is applied
      expect(providers[ProviderV2.ID.make("bedrock-local")]).toBeDefined()
      expect(providers[ProviderV2.ID.make("bedrock-local")].key).toBe("test-bearer-token")
    }),
  { config: { provider: { "bedrock-local": { name: "Bedrock Local", npm: "@ai-sdk/openai-compatible", api: "https://bedrock.example.com/v1", models: { model: { name: "Model", tool_call: true, limit: { context: 8000, output: 2000 } } } } } } },
)

it.instance(
  "custom bedrock-like provider: custom endpoint option is preserved",
  () =>
    Effect.gen(function* () {
      const providers = yield* list
      expect(providers[ProviderV2.ID.make("bedrock-local")].options?.endpoint).toBe(
        "https://bedrock-runtime.us-east-1.vpce-xxxxx.amazonaws.com",
      )
    }),
  {
    config: {
      provider: {
        "bedrock-local": {
          name: "Bedrock Local",
          npm: "@ai-sdk/openai-compatible",
          api: "https://bedrock.example.com/v1",
          models: { model: { name: "Model", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { apiKey: "test-key", endpoint: "https://bedrock-runtime.us-east-1.vpce-xxxxx.amazonaws.com" },
        },
      },
    },
  },
)

it.instance(
  "custom bedrock-like provider: prefixed model keys are kept as-is",
  () =>
    Effect.gen(function* () {
      const providers = yield* list
      const models = Object.keys(providers[ProviderV2.ID.make("bedrock-local")].models)
      expect(models).toContain("us.anthropic.claude-opus-4-5-20251101-v1:0")
      expect(models).toContain("global.anthropic.claude-opus-4-5-20251101-v1:0")
      expect(models).toContain("anthropic.claude-opus-4-5-20251101-v1:0")
    }),
  {
    config: {
      provider: {
        "bedrock-local": {
          name: "Bedrock Local",
          npm: "@ai-sdk/openai-compatible",
          api: "https://bedrock.example.com/v1",
          models: {
            "us.anthropic.claude-opus-4-5-20251101-v1:0": { name: "Claude Opus 4.5 (US)" },
            "global.anthropic.claude-opus-4-5-20251101-v1:0": { name: "Claude Opus 4.5 (Global)" },
            "anthropic.claude-opus-4-5-20251101-v1:0": { name: "Claude Opus 4.5" },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)
// kilocode_change end

// Cross-region inference profile prefix handling.
// Models from models.dev may come with prefixes already (e.g. us., eu., global.).
// These should NOT be double-prefixed when passed to the SDK.

describe("Bedrock cross-region prefix detection", () => {
  const crossRegionPrefixes = ["global.", "us.", "eu.", "jp.", "apac.", "au."]

  test("should detect global. prefix", () => {
    expect(crossRegionPrefixes.some((p) => "global.anthropic.claude-opus-4-5-20251101-v1:0".startsWith(p))).toBe(true)
  })

  test("should detect us. prefix", () => {
    expect(crossRegionPrefixes.some((p) => "us.anthropic.claude-opus-4-5-20251101-v1:0".startsWith(p))).toBe(true)
  })

  test("should detect eu. prefix", () => {
    expect(crossRegionPrefixes.some((p) => "eu.anthropic.claude-opus-4-5-20251101-v1:0".startsWith(p))).toBe(true)
  })

  test("should detect jp. prefix", () => {
    expect(crossRegionPrefixes.some((p) => "jp.anthropic.claude-sonnet-4-20250514-v1:0".startsWith(p))).toBe(true)
  })

  test("should detect apac. prefix", () => {
    expect(crossRegionPrefixes.some((p) => "apac.anthropic.claude-sonnet-4-20250514-v1:0".startsWith(p))).toBe(true)
  })

  test("should detect au. prefix", () => {
    expect(crossRegionPrefixes.some((p) => "au.anthropic.claude-sonnet-4-5-20250929-v1:0".startsWith(p))).toBe(true)
  })

  test("should NOT detect prefix for non-prefixed model", () => {
    expect(crossRegionPrefixes.some((p) => "anthropic.claude-opus-4-5-20251101-v1:0".startsWith(p))).toBe(false)
  })

  test("should NOT detect prefix for amazon nova models", () => {
    expect(crossRegionPrefixes.some((p) => "amazon.nova-pro-v1:0".startsWith(p))).toBe(false)
  })

  test("should NOT detect prefix for cohere models", () => {
    expect(crossRegionPrefixes.some((p) => "cohere.command-r-plus-v1:0".startsWith(p))).toBe(false)
  })
})