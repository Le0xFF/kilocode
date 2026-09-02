import { describe, it, expect } from "bun:test"
import {
  providerSortKey,
  buildTriggerLabel,
  stripSubProviderPrefix,
  sanitizeName,
  PROVIDER_ORDER,
  freeDataLabel,
  isDataCollectedModel,
  hasByok,
  isFree,
  isAuto,
  autoSummary,
  autoChoices,
  rankModelSearch,
  mostUsedModels,
} from "../../webview-ui/src/components/shared/model-selector-utils"
import type { EnrichedModel } from "../../webview-ui/src/context/provider"

const labels = { select: "Select model", noProviders: "No providers", notSet: "Not set" }

describe("providerSortKey", () => {
  it("returns correct index for known providers", () => {
    expect(providerSortKey("anthropic")).toBe(0)
    expect(providerSortKey("deepseek")).toBe(1)
    expect(providerSortKey("openai")).toBe(2)
    expect(providerSortKey("google")).toBe(3)
  })

  it("returns order length for unknown provider", () => {
    expect(providerSortKey("unknown-provider")).toBe(PROVIDER_ORDER.length)
  })

  it("is case-insensitive", () => {
    expect(providerSortKey("Anthropic")).toBe(providerSortKey("anthropic"))
    expect(providerSortKey("OpenAI")).toBe(providerSortKey("openai"))
  })

  it("respects custom order array", () => {
    const order = ["z-provider", "a-provider"]
    expect(providerSortKey("z-provider", order)).toBe(0)
    expect(providerSortKey("a-provider", order)).toBe(1)
    expect(providerSortKey("other", order)).toBe(2)
  })

  it("sorts providers correctly when used with sort", () => {
    const ids = ["google", "anthropic", "deepseek", "openai"]
    const sorted = ids.slice().sort((a, b) => providerSortKey(a) - providerSortKey(b))
    expect(sorted).toEqual(["anthropic", "deepseek", "openai", "google"])
  })
})

describe("stripSubProviderPrefix", () => {
  it("strips prefix before ': '", () => {
    expect(stripSubProviderPrefix("Anthropic: Claude Sonnet")).toBe("Claude Sonnet")
    expect(stripSubProviderPrefix("OpenAI: GPT-4o")).toBe("GPT-4o")
  })

  it("leaves names without ': ' unchanged", () => {
    expect(stripSubProviderPrefix("GPT-4o")).toBe("GPT-4o")
    expect(stripSubProviderPrefix("claude-3-5-sonnet")).toBe("claude-3-5-sonnet")
  })
})

describe("sanitizeName", () => {
  it("strips trailing (free) suffix", () => {
    expect(sanitizeName("Llama 3 (free)")).toBe("Llama 3")
  })

  it("is case-insensitive for parenthesized suffix", () => {
    expect(sanitizeName("Model (Free)")).toBe("Model")
    expect(sanitizeName("Model (FREE)")).toBe("Model")
  })

  it("preserves bare trailing Free in names like 'Auto Free'", () => {
    expect(sanitizeName("Auto Free")).toBe("Auto Free")
    expect(sanitizeName("Mixtral free")).toBe("Mixtral free")
    expect(sanitizeName("Mistral:free")).toBe("Mistral:free")
    expect(sanitizeName("Gemma-free")).toBe("Gemma-free")
    expect(sanitizeName("Model FREE")).toBe("Model FREE")
  })

  it("leaves names without (free) suffix unchanged", () => {
    expect(sanitizeName("GPT-4o")).toBe("GPT-4o")
    expect(sanitizeName("Claude Sonnet")).toBe("Claude Sonnet")
  })

  it("does not strip 'free' from the middle of a name", () => {
    expect(sanitizeName("FreeAgent Pro")).toBe("FreeAgent Pro")
  })

  it("handles extra whitespace around (free) suffix", () => {
    expect(sanitizeName("Llama 3 (free)  ")).toBe("Llama 3")
    expect(sanitizeName("Model  (free)  ")).toBe("Model")
  })
})

describe("freeDataLabel", () => {
  it("uses the data collection label without repeating free", () => {
    expect(freeDataLabel("Free", "Data may be used for training")).toBe("Data may be used for training")
  })
})

describe("isFree", () => {
  it("uses only explicit free metadata", () => {
    expect(isFree({ isFree: true })).toBe(true)
    expect(isFree({ isFree: false })).toBe(false)
    expect(isFree({})).toBe(false)
  })
})

describe("isAuto", () => {
  it("matches auto-prefixed or auto-small model ids", () => {
    expect(isAuto({ providerID: "openai", id: "auto-efficient" })).toBe(true)
    expect(isAuto({ providerID: "openai", id: "auto-small" })).toBe(true)
    expect(isAuto({ providerID: "anthropic", id: "claude-sonnet" })).toBe(false)
  })
})

describe("autoChoices", () => {
  it("uses backend Auto routes and resolves names when available", () => {
    expect(
      autoChoices(
        {
          providerID: "openai",
          id: "auto-efficient",
          autoRouting: { models: ["provider/model", "missing/model"] },
        },
        [{ id: "provider/model", name: "Provider: Model" }],
      ),
    ).toEqual([
      { id: "provider/model", name: "Model" },
      { id: "missing/model", name: "missing/model" },
    ])
  })

  it("shows routes for any Auto model when present", () => {
    expect(
      autoChoices(
        {
          providerID: "openai",
          id: "auto-frontier",
          autoRouting: { models: ["provider/model"] },
        },
        [{ id: "provider/model", name: "Provider: Model" }],
      ),
    ).toEqual([{ id: "provider/model", name: "Model" }])
    expect(
      autoChoices({
        providerID: "openai",
        id: "auto-free",
        autoRouting: { models: ["provider/model"] },
      }),
    ).toEqual([{ id: "provider/model", name: "provider/model" }])
  })

  it("ignores missing routes and non-Auto models", () => {
    expect(autoChoices({ providerID: "openai", id: "auto-efficient" })).toEqual([])
    expect(
      autoChoices({
        providerID: "openai",
        id: "anthropic/claude-sonnet",
        autoRouting: { models: ["provider/model"] },
      }),
    ).toEqual([])
  })
})

describe("autoSummary", () => {
  it("uses the first description paragraph for compact tooltips", () => {
    expect(
      autoSummary({
        options: {
          description: "Routes through available models.\n\nLong details.",
        },
      }),
    ).toBe("Routes through available models.")
  })

  it("falls back when there is no description", () => {
    expect(autoSummary({})).toBe("Routes requests automatically.")
  })
})

const SEARCH_MODELS: EnrichedModel[] = [
  { id: "solar-pro", name: "Solar Pro", providerID: "nvidia", providerName: "NVIDIA" },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", providerID: "openai", providerName: "OpenAI" },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", providerID: "anthropic", providerName: "Anthropic" },
  { id: "gpt-5.6", name: "GPT-5.6", providerID: "anthropic", providerName: "Anthropic" },
  { id: "xai/grok-4.20", name: "SpaceXAI: Grok 4.20", providerID: "xai", providerName: "xAI" },
]

describe("rankModelSearch", () => {
  it("matches colon-separated prefixes in model display names", () => {
    expect(rankModelSearch(SEARCH_MODELS, "SpaceX").map((model) => model.name)).toEqual(["SpaceXAI: Grok 4.20"])
  })

  it("prefers an exact model token over a longer prefix match", () => {
    expect(
      rankModelSearch(SEARCH_MODELS, "sol")
        .slice(0, 2)
        .map((model) => model.name),
    ).toEqual(["GPT-5.6 Sol", "GPT-5.6 Sol"])
  })

  it("keeps provider variants together and uses usage to order equivalent variants", () => {
    const result = rankModelSearch(SEARCH_MODELS, "sol", {
      usage: { "anthropic/gpt-5.6-sol": { count: 4, lastUsed: 10 }, "openai/gpt-5.6-sol": { count: 1, lastUsed: 20 } },
    })
    expect(result.slice(0, 2).map((model) => model.providerID)).toEqual(["anthropic", "openai"])
  })

  it("does not let usage make a weaker model beat an exact match", () => {
    const result = rankModelSearch(SEARCH_MODELS, "sol", {
      usage: { "nvidia/solar-pro": { count: 1000, lastUsed: 100 } },
    })
    expect(result[0]?.name).toBe("GPT-5.6 Sol")
  })
})

describe("mostUsedModels", () => {
  it("orders suggestions by personal count and excludes favorites", () => {
    const result = mostUsedModels(
      SEARCH_MODELS,
      {
        "nvidia/solar-pro": { count: 2, lastUsed: 20 },
        "openai/gpt-5.6-sol": { count: 5, lastUsed: 10 },
      },
      new Set(["openai/gpt-5.6-sol"]),
    )
    expect(result.map((model) => model.providerID)).toEqual(["nvidia"])
  })
})

describe("isDataCollectedModel", () => {
  it("uses only explicit prompt training metadata", () => {
    expect(isDataCollectedModel({ mayTrainOnYourPrompts: true })).toBe(true)
    expect(isDataCollectedModel({ mayTrainOnYourPrompts: false })).toBe(false)
    expect(isDataCollectedModel({})).toBe(false)
  })
})

describe("hasByok", () => {
  it("uses only explicit user BYOK metadata", () => {
    expect(hasByok({ hasUserByokAvailable: true })).toBe(true)
    expect(hasByok({ hasUserByokAvailable: false })).toBe(false)
    expect(hasByok({})).toBe(false)
  })
})

describe("buildTriggerLabel", () => {
  it("returns resolved model name unchanged", () => {
    expect(buildTriggerLabel("GPT-4o", "openai", null, false, "", true, labels)).toBe("GPT-4o")
  })

  it("returns providerID / modelID for a raw selection", () => {
    const raw = { providerID: "openai", modelID: "gpt-4.1" }
    expect(buildTriggerLabel(undefined, undefined, raw, false, "", true, labels)).toBe("openai / gpt-4.1")
  })

  it("returns clearLabel when allowClear and no selection", () => {
    expect(buildTriggerLabel(undefined, undefined, null, true, "None", true, labels)).toBe("None")
  })

  it("falls back to labels.notSet when allowClear and clearLabel is empty", () => {
    expect(buildTriggerLabel(undefined, undefined, null, true, "", true, labels)).toBe("Not set")
  })

  it("returns labels.select when providers exist and no selection", () => {
    expect(buildTriggerLabel(undefined, undefined, null, false, "", true, labels)).toBe("Select model")
  })

  it("returns labels.noProviders when no providers available", () => {
    expect(buildTriggerLabel(undefined, undefined, null, false, "", false, labels)).toBe("No providers")
  })

  it("prefers resolvedName over raw selection", () => {
    const raw = { providerID: "anthropic", modelID: "claude-3-5-sonnet" }
    expect(buildTriggerLabel("Claude Sonnet", undefined, raw, false, "", true, labels)).toBe("Claude Sonnet")
  })

  it("ignores partial raw selection (only providerID)", () => {
    const raw = { providerID: "anthropic", modelID: "" }
    expect(buildTriggerLabel(undefined, undefined, raw, false, "", true, labels)).toBe("Select model")
  })

  it("ignores partial raw selection (only modelID)", () => {
    const raw = { providerID: "", modelID: "claude-3-5-sonnet" }
    expect(buildTriggerLabel(undefined, undefined, raw, false, "", true, labels)).toBe("Select model")
  })
})