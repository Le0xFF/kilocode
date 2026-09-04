import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Provider } from "../../src/provider/provider"
import { patchModelsDevModel } from "../../src/kilocode/provider/provider"

describe("Kilo provider model metadata", () => {
  test("preserves Auto Efficient routing models from Models.dev data", () => {
    const patch = patchModelsDevModel("lmstudio", {
      autoRouting: { models: ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.6"] },
    })

    expect(patch.autoRouting).toEqual({
      models: ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.6"],
    })
  })

  test("Provider.Model schema accepts Auto Efficient routing models", () => {
    const model = Schema.decodeUnknownSync(Provider.Model)({
      id: "lmstudio/qwen3-30b-a3b-2507",
      providerID: "lmstudio",
      api: { id: "lmstudio", url: "http://127.0.0.1:1234/v1", npm: "@ai-sdk/openai-compatible" },
      name: "Qwen3 30B A3B",
      family: "qwen",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 262144, output: 16384 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2025-07-30",
      variants: {},
      autoRouting: { models: ["google/gemini-2.5-flash"] },
    })

    expect(model.autoRouting).toEqual({ models: ["google/gemini-2.5-flash"] })
  })
})
