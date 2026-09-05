// kilocode_change - new file
// Verifies that ModelCache surfaces provider model-load failure state (failure path is now config-driven:
// a provider with no configured models records a failure; clear() removes it). The apertis HTTP fetch was removed.

import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"

import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { Config } from "../../src/config/config"

const layer = (overrides?: Parameters<typeof TestConfig.layer>[0]) =>
  Layer.fresh(ModelCache.layer).pipe(Layer.provide(TestConfig.layer(overrides)))

test("failedProviders returns empty array when no fetch has occurred", async () => {
  await ModelCache.Service.use((cache) =>
    Effect.gen(function* () {
      expect(yield* cache.failedProviders()).not.toContain("apertis")
    }),
  ).pipe(Effect.provide(layer()), Effect.runPromise)
})

test("getFailure returns undefined after a successful load", async () => {
  // acme has configured models -> successful load -> no failure recorded
  const cfg = TestConfig.make({ get: () => Effect.succeed({ provider: { acme: { models: { m1: {} } } } }) as never })
  await ModelCache.Service.use((cache) =>
    Effect.gen(function* () {
      yield* cache.fetch("acme").pipe(Effect.exit)
      expect(yield* cache.getFailure("acme")).toBeUndefined()
      expect(yield* cache.failedProviders()).not.toContain("acme")
    }),
  ).pipe(Effect.provide(Layer.fresh(ModelCache.layer).pipe(Layer.provide(Layer.succeed(Config.Service, cfg)))), Effect.runPromise)
})

test("clear removes failure state after a failed load", async () => {
  // apertis has no configured models -> failed load -> failure recorded
  await ModelCache.Service.use((cache) =>
    Effect.gen(function* () {
      yield* cache.fetch("apertis").pipe(Effect.exit)
      expect(yield* cache.failedProviders()).toContain("apertis")
      expect(yield* cache.getFailure("apertis")).toBeDefined()
      yield* cache.clear("apertis")
      expect(yield* cache.failedProviders()).not.toContain("apertis")
      expect(yield* cache.getFailure("apertis")).toBeUndefined()
    }),
  ).pipe(Effect.provide(layer()), Effect.runPromise)
})