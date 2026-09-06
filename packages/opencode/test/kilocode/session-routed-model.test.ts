import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Part, StepFinishPart } from "@kilocode/sdk/v2"
import { KiloRoutedModel } from "../../src/kilocode/session/routed-model"
import { LLMAISDK } from "../../src/session/llm/ai-sdk"

describe("session routed model", () => {
  type Event = Parameters<typeof LLMAISDK.toLLMEvents>[1]

  const adapt = (events: ReadonlyArray<Event>) => {
    const state = LLMAISDK.adapterState()
    return Effect.runPromise(
      Effect.forEach(events, (event) => LLMAISDK.toLLMEvents(state, event)).pipe(Effect.map((items) => items.flat())),
    )
  }
  const unchecked = (input: unknown) => input as Event
  const finish = (model?: StepFinishPart["model"], id = "finish") =>
    ({
      id,
      sessionID: "session",
      messageID: "message",
      type: "step-finish",
      reason: "stop",
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      model,
    }) as Part

  test("preserves finish-step response model in provider metadata", async () => {
    const events = await adapt([
      unchecked({
        type: "finish-step",
        response: { id: "response-1", timestamp: new Date(0), modelId: "openai/gpt-5.5-20260423" },
        finishReason: "stop",
        rawFinishReason: "stop",
        usage: {},
        providerMetadata: { openrouter: { routed: true }, kilocode: { existing: true } },
      }),
    ])

    expect(events).toHaveLength(1)
    const event = events[0]
    if (event.type !== "step-finish") throw new Error("expected step-finish")
    expect(event.providerMetadata).toEqual({
      openrouter: { routed: true },
      kilocode: { existing: true, routedModelID: "openai/gpt-5.5-20260423" },
    })
  })

  test("leaves finish-step metadata unchanged without a response model", async () => {
    const meta = { openrouter: { routed: true } }
    const events = await adapt([
      unchecked({
        type: "finish-step",
        response: { id: "response-1", timestamp: new Date(0) },
        finishReason: "stop",
        rawFinishReason: "stop",
        usage: {},
        providerMetadata: meta,
      }),
    ])

    expect(events).toHaveLength(1)
    const event = events[0]
    if (event.type !== "step-finish") throw new Error("expected step-finish")
    expect(event.providerMetadata).toEqual(meta)
  })

  test("shortens date-suffixed routed model ids for display", () => {
    expect(KiloRoutedModel.display("moonshotai/kimi-k2.7-code-20260612")).toBe("moonshotai/kimi-k2.7-code")
    expect(KiloRoutedModel.display("openai/gpt-5.5-2026-04-23")).toBe("openai/gpt-5.5")
    expect(KiloRoutedModel.display("openai/gpt-5.5")).toBe("openai/gpt-5.5")
  })

  test("formats routed model names for compact display", () => {
    expect(KiloRoutedModel.displayName("Qwen: Qwen3.7 Plus (20% off)")).toBe("Qwen 3.7 Plus")
    expect(KiloRoutedModel.displayName("anthropic.claude-opus-4-5-20251101-v1:0")).toBe(
      "anthropic.claude-opus-4-5-20251101-v1:0",
    )
    expect(KiloRoutedModel.displayName("moonshotai/kimi-k2.7-code")).toBe("kimi-k2.7-code")
    expect(KiloRoutedModel.displayName("o3")).toBe("o3")
  })
})