import { describe, expect, test } from "bun:test"
import { Provider } from "../../../src/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { filterPromptTrainingModels, nonEmptyProviders } from "../../../src/kilocode/provider/model-filter"

function model(id: string, training?: boolean): Provider.Model {
  return {
    id: ModelV2.ID.make(id),
    providerID: ProviderV2.ID.make("lmstudio"),
    api: { id: "lmstudio", url: "http://127.0.0.1:1234/v1", npm: "@ai-sdk/openai-compatible" },
    name: id,
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
    limit: { context: 128000, output: 4096 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
    mayTrainOnYourPrompts: training,
  }
}

function provider(id: string, models: Record<string, Provider.Model>): Provider.Info {
  return {
    id: ProviderV2.ID.make(id),
    name: id,
    source: "api",
    env: [],
    options: {},
    models,
  }
}

describe("prompt-training model filter", () => {
  test("hides only explicitly marked training models", () => {
    const providers = {
      lmstudio: provider("lmstudio", {
        training: model("training", true),
        private: model("private", false),
        unknown: model("unknown"),
      }),
      other: provider("other", {
        // A public model that is not flagged for prompt training stays visible.
        public: { ...model("public", false), id: ModelV2.ID.make("public"), providerID: ProviderV2.ID.make("other") },
      }),
    }

    const result = filterPromptTrainingModels(providers, true)

    expect(Object.keys(result.lmstudio.models)).toEqual(["private", "unknown"])
    expect(Object.keys(result.other.models)).toEqual(["public"])
    expect(Object.keys(providers.lmstudio.models)).toEqual(["training", "private", "unknown"])
  })

  test("preserves the catalog when disabled", () => {
    const providers = { lmstudio: provider("lmstudio", { training: model("training", true) }) }
    expect(filterPromptTrainingModels(providers, false)).toBe(providers)
  })

  test("excludes providers without visible models from default selection", () => {
    const providers = { lmstudio: provider("lmstudio", { training: model("training", true) }) }
    const visible = filterPromptTrainingModels(providers, true)
    expect(nonEmptyProviders(visible)).toEqual({})
  })
})
