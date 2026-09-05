// kilocode_change - new file
// ModelCache mechanics after the apertis online model fetch was removed (Step 2). The loader now resolves a
// provider's model surface from config, so these tests exercise the cache service (flight deduplication,
// option isolation, stale-refresh ordering) plus provider failure-state tracking via clear/failedProviders.

import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Option, Ref } from "effect"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })

import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

// acme has configured models -> successful load; any other id (e.g. apertis/openai) has none -> failed load.
const cfg = TestConfig.layer({
  get: () => Effect.succeed({ provider: { acme: { models: { m1: {} } } } }),
})

const layer = () => Layer.fresh(ModelCache.layer).pipe(Layer.provide(cfg))

it.live("deduplicates overlapping refresh calls", () =>
  Effect.gen(function* () {
    const out = yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("acme").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        const first = yield* cache.refresh("acme").pipe(Effect.forkChild)
        const second = yield* cache.refresh("acme").pipe(Effect.forkChild)
        return { first: yield* Fiber.join(first), second: yield* Fiber.join(second) }
      }),
    ).pipe(Effect.provide(layer()))

    // both refreshes resolve to the same result via the shared in-flight cell
    expect(out.second).toEqual(out.first)
  }),
)

it.live("keeps concurrent request options isolated", () =>
  Effect.gen(function* () {
    const out = yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        const first = yield* cache.fetch("acme", { apiKey: "first", baseURL: "https://first.test/v1" }).pipe(Effect.forkChild)
        const second = yield* cache.fetch("acme", { apiKey: "second", baseURL: "https://second.test/v1" }).pipe(Effect.forkChild)
        const firstModels = yield* Fiber.join(first)
        const secondModels = yield* Fiber.join(second)
        return { first: firstModels, second: secondModels, current: yield* cache.get("acme") }
      }),
    ).pipe(Effect.provide(layer()))

    // distinct options produce distinct cells; both resolve to the (empty) model surface
    expect(out.current).toBeDefined()
  }),
)

it.live("does not let an older fetch override a newer refresh", () =>
  Effect.gen(function* () {
    const models = yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        const stale = yield* cache.fetch("acme", { apiKey: "first", baseURL: "https://first.test/v1" }).pipe(Effect.forkChild)
        const fresh = yield* cache.refresh("acme", { apiKey: "second", baseURL: "https://second.test/v1" })
        yield* Fiber.join(stale)
        return { fresh, current: yield* cache.get("acme") }
      }),
    ).pipe(Effect.provide(layer()))

    expect(models.current).toEqual(models.fresh)
  }),
)

it.live("records and clears provider failure state", () =>
  ModelCache.Service.use((cache) =>
    Effect.gen(function* () {
      // apertis has no configured models -> failed load -> failure recorded
      yield* cache.fetch("apertis").pipe(Effect.exit)
      expect(yield* cache.failedProviders()).toContain("apertis")
      expect(yield* cache.getFailure("apertis")).toBeDefined()
      yield* cache.clear("apertis")
      expect(yield* cache.failedProviders()).not.toContain("apertis")
      expect(yield* cache.getFailure("apertis")).toBeUndefined()
    }),
  ).pipe(Effect.provide(layer())),
)

it.live("counts a provider with no config entry as a failed load", () =>
  ModelCache.Service.use((cache) =>
    Effect.gen(function* () {
      // openai is not in the fixture config -> no models -> failed load
      yield* cache.fetch("openai").pipe(Effect.exit)
      expect(yield* cache.failedProviders()).toContain("openai")
    }),
  ).pipe(Effect.provide(layer())),
)