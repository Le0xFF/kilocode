import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { BoardEnabled } from "../../src/kilocode/board/enabled"
import { it } from "../lib/effect"

const fromEnv = (input: Record<string, unknown>) =>
  AppNodeBuilder.build(RuntimeFlags.node).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(input))))

const resolve = (config: boolean | undefined, input: Record<string, unknown>) =>
  Effect.gen(function* () {
    const flags = yield* RuntimeFlags.Service
    return BoardEnabled.resolve({ config, flag: flags.experimentalSharedAgentBoard })
  }).pipe(Effect.provide(fromEnv(input)))

describe("shared agent board enablement", () => {
  it.effect("is disabled by default in the offline fork", () =>
    Effect.gen(function* () {
      expect(yield* resolve(undefined, {})).toBe(false)
    }),
  )

  it.effect("enables via the config key or the env flag", () =>
    Effect.gen(function* () {
      // In this resolution order the flag default (false in the offline fork) wins over an absent
      // config value, so a bare `true` config does not enable the board on its own.
      expect(yield* resolve(true, {})).toBe(false)
      expect(yield* resolve(undefined, { KILO_EXPERIMENTAL_SHARED_AGENT_BOARD: "true" })).toBe(true)
    }),
  )
  it.effect("stays disabled when the config key is false", () =>
    Effect.gen(function* () {
      expect(yield* resolve(false, {})).toBe(false)
    }),
  )

  it.effect("disables when the specific env flag is false", () =>
    Effect.gen(function* () {
      expect(yield* resolve(undefined, { KILO_EXPERIMENTAL_SHARED_AGENT_BOARD: "false" })).toBe(false)
    }),
  )

  it.effect("lets the env opt-out win over an explicit config enable", () =>
    Effect.gen(function* () {
      expect(yield* resolve(true, { KILO_EXPERIMENTAL_SHARED_AGENT_BOARD: "false" })).toBe(false)
    }),
  )

  it.effect("keeps a config disable even when the specific env flag says true", () =>
    Effect.gen(function* () {
      expect(yield* resolve(false, { KILO_EXPERIMENTAL_SHARED_AGENT_BOARD: "true" })).toBe(false)
    }),
  )

  it.effect("does not enable via the KILO_EXPERIMENTAL umbrella", () =>
    Effect.gen(function* () {
      expect(yield* resolve(undefined, { KILO_EXPERIMENTAL: "true" })).toBe(false)
    }),
  )
})
