import { describe, expect, test } from "bun:test"
import {
  buildModelPickerOptions,
  type ModelPickerProvider,
  type ModelPickerRef,
} from "../../src/kilocode/model-picker"

const KILO: ModelPickerProvider = {
  id: "kilo",
  name: "Kilo Gateway",
  models: {
    "anthropic/claude-sonnet-4-5": {
      id: "anthropic/claude-sonnet-4-5",
      name: "Anthropic Claude Sonnet 4.5",
      release_date: "2025-09-29",
    },
    "anthropic/claude-sonnet-4": {
      id: "anthropic/claude-sonnet-4",
      name: "Anthropic Claude Sonnet 4",
      release_date: "2025-05-22",
    },
    "openai/gpt-5": {
      id: "openai/gpt-5",
      name: "OpenAI GPT 5",
      release_date: "2025-08-07",
    },
  },
}

const BEDROCK: ModelPickerProvider = {
  id: "amazon-bedrock",
  name: "Amazon Bedrock",
  models: {
    "anthropic.claude-sonnet-4-20250514-v1:0": {
      id: "anthropic.claude-sonnet-4-20250514-v1:0",
      name: "Claude Sonnet 4",
      release_date: "2025-05-22",
    },
  },
}

const providers = [KILO, BEDROCK]

const sonnet45: ModelPickerRef = { providerID: "kilo", modelID: "anthropic/claude-sonnet-4-5" }
const bedrockSonnet: ModelPickerRef = {
  providerID: "amazon-bedrock",
  modelID: "anthropic.claude-sonnet-4-20250514-v1:0",
}

function build(input: { recents?: ModelPickerRef[]; favorites?: ModelPickerRef[]; query?: string } = {}) {
  return buildModelPickerOptions({
    providers,
    connected: true,
    showExtra: true,
    ...input,
  })
}

const inCategory = (options: ReturnType<typeof build>, category: string) =>
  options.filter((option) => option.category === category).map((option) => option.modelID)

describe("model picker options", () => {
  test("matches colon-separated prefixes in model display names", () => {
    const options = buildModelPickerOptions({
      providers: [
        {
          id: "kilo",
          name: "Kilo Gateway",
          models: {
            "xai/grok-4.20": {
              id: "xai/grok-4.20",
              name: "SpaceXAI: Grok 4.20",
            },
          },
        },
      ],
      query: "SpaceX",
    })

    expect(options.map((option) => option.modelID)).toEqual(["xai/grok-4.20"])
  })

  test("keeps recently used models in their provider section after they are used", () => {
    const options = build({ recents: [sonnet45] })

    expect(inCategory(options, "Recent")).toEqual([sonnet45.modelID])
    // the kilo provider now groups under its own name instead of a special "Recommended" section
    expect(inCategory(options, "Kilo Gateway")).toEqual(["anthropic/claude-sonnet-4-5", "anthropic/claude-sonnet-4", "openai/gpt-5"])
  })

  test("groups each provider under its own name when signed in", () => {
    const options = build()

    expect(inCategory(options, "Kilo Gateway")).toEqual(["anthropic/claude-sonnet-4-5", "anthropic/claude-sonnet-4", "openai/gpt-5"])
    expect(inCategory(options, "Amazon Bedrock")).toEqual(["anthropic.claude-sonnet-4-20250514-v1:0"])
  })

  test("filtering by provider name does not leak other providers", () => {
    const options = build({ query: "kilo" })

    expect(options.every((option) => option.providerID === "kilo")).toBe(true)
  })

  test("still matches model titles", () => {
    const options = build({ query: "gpt 5" })

    expect(options.map((option) => option.modelID)).toEqual(["openai/gpt-5"])
  })

  test("drops the extra sections when they are not rendered", () => {
    const options = buildModelPickerOptions({
      providers,
      connected: false,
      showExtra: false,
      recents: [sonnet45],
      query: "sonnet",
    })

    expect(options.every((option) => option.category === undefined)).toBe(true)
    expect(options.some((option) => option.modelID === sonnet45.modelID)).toBe(true)
  })
})