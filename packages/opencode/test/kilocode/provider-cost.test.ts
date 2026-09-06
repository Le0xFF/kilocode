import { describe, expect, test } from "bun:test"
import { Usage } from "@opencode-ai/llm"
import { Session as SessionNs } from "@/session/session"
import type { Provider } from "@/provider/provider"

function createModel(opts: {
  context: number
  output: number
  input?: number
  cost?: Provider.Model["cost"]
  npm?: string
}): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: opts.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: opts.npm ?? "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

const baseUsage = new Usage({
  inputTokens: 1_000_000,
  outputTokens: 100_000,
  totalTokens: 1_100_000,
})

const model = () =>
  createModel({
    context: 100_000,
    output: 32_000,
    cost: { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
  })

// Calculated cost for the `model()` + `baseUsage` pair: 1M input * $3 + 100k output * $15 = 3 + 1.5
const fallback = 3 + 1.5

describe("KiloSession.providerCost — raw AI SDK usage escape hatch", () => {
  test("uses preserved AI SDK raw usage cost_details", () => {
    const result = SessionNs.getUsage({
      model: model(),
      usage: new Usage({
        inputTokens: baseUsage.inputTokens,
        outputTokens: baseUsage.outputTokens,
        totalTokens: baseUsage.totalTokens,
        providerMetadata: {
          aiSdk: {
            cost: 0.0439847,
            cost_details: { upstream_inference_cost: 0.879694 },
          },
        },
      }),
    })

    expect(result.cost).toBe(0.879694)
  })

  test("ignores provider `cost` when no upstream_inference_cost is reported", () => {
    const result = SessionNs.getUsage({
      model: model(),
      usage: new Usage({
        inputTokens: baseUsage.inputTokens,
        outputTokens: baseUsage.outputTokens,
        totalTokens: baseUsage.totalTokens,
        providerMetadata: { aiSdk: { cost: 0.5 } },
      }),
    })

    expect(result.cost).toBe(fallback)
  })
})

describe("KiloSession.providerCost — fallback", () => {
  test("falls back to calculated cost when no provider cost is reported", () => {
    const result = SessionNs.getUsage({
      model: model(),
      usage: baseUsage,
      // No provider usage cost — should fall back
    })

    expect(result.cost).toBe(fallback)
  })
})