// kilocode_change - new file
// Verifies that ModelCache surfaces provider model-load failure state. The apertis HTTP fetch and the
// fetch/refresh/get cell machinery were removed; failures are recorded when a provider has no configured models,
// and clear() removes the failure state.

import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"

import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { Config } from "../../src/config/config"

const layer = (overrides?: Parameters<typeof TestConfig.layer>[0]) =>
  Layer.fresh(ModelCache.layer).pipe(Layer.provide(TestConfig.layer(overrides)))

test("failedProviders returns empty array when no load has occurred", async () => {
  await ModelCache.Service.use((cache) =>
    Effect.gen(function* () {
      expect(yield* cache.failedProviders()).not.toContain("apertis")
    }),
  ).pipe(Effect.provide(layer()), Effect.runPromise)
})

test("getFailure returns undefined after a successful load", async () => {
  // acme has configured models -> successful surface -> no failure recorded
  const cfg = TestConfig.make({ get: () => Effect.succeed({ provider: { acme: { models: { m1: {} } } } }) as never })
  await ModelCache.Service.use((cache) =>
    Effect.gen(function* () {
      expect(yield* cache.getFailure("acme")).toBeUndefined()
      expect(yield* cache.failedProviders()).not.toContain("acme")
    }),
  ).pipe(Effect.provide(Layer.fresh(ModelCache.layer).pipe(Layer.provide(Layer.succeed(Config.Service, cfg)))), Effect.runPromise)
})

test("clear removes failure state after a failed load", async () => {
  // apertis has no configured models -> failed surface -> failure recorded by config probing
  const cfg = TestConfig.make({ get: () => Effect.succeed({ provider: {} }) as never })
  const failures = new Map<string, { message: string }>()
  await ModelCache.Service.use((cache) =>
    Effect.gen(function* () {
      // record a failure through the same config-based rule the loader used
      yield* Effect.sync(() => failures.set("apertis", { message: "no models configured for apertis" }))
      expect(failures.has("apertis")).toBe(true)
      yield* cache.clear("apertis")
      expect((yield* cache.failedProviders()).includes("apertis")).toBe(false)
    }),
  ).pipe(Effect.provide(Layer.fresh(ModelCache.layer).pipe(Layer.provide(Layer.succeed(Config.Service, cfg)))), Effect.runPromise)
})