// kilocode_change - new file
// Verifies that ModelCache surfaces apertis model-fetch failure state.

import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })

import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const auth = Layer.mock(Auth.Service)({
  get: () => Effect.succeed(undefined),
})

function layer(fail: boolean) {
  const http = HttpClient.make((request) =>
    fail
      ? Effect.fail(new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request }) }))
      : Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ data: [{ id: "apertis-model", owned_by: "apertis" }] }))),
  )
  return Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(TestConfig.layer()),
    Layer.provide(auth),
  )
}

const ok = testEffect(layer(false))
const bad = testEffect(layer(true))

ok.live("failedProviders returns empty array when no fetch has occurred", () =>
  ModelCache.Service.use((cache) =>
    Effect.gen(function* () {
      expect(yield* cache.failedProviders()).not.toContain("apertis")
    }),
  ),
)

ok.live("getFailure returns undefined when fetch succeeds", () =>
  ModelCache.Service.use((cache) =>
    Effect.gen(function* () {
      yield* cache.fetch("apertis", { apiKey: "test-key", baseURL: "https://apertis.test/v1" })
      expect(yield* cache.getFailure("apertis")).toBeUndefined()
      expect(yield* cache.failedProviders()).not.toContain("apertis")
    }),
  ),
)

bad.live("clear removes failure state after a failed fetch", () =>
  ModelCache.Service.use((cache) =>
    Effect.gen(function* () {
      yield* cache.fetch("apertis", { apiKey: "test-key", baseURL: "https://apertis.test/v1" }).pipe(Effect.exit)
      expect(yield* cache.failedProviders()).toContain("apertis")
      expect(yield* cache.getFailure("apertis")).toBeDefined()
      yield* cache.clear("apertis")
      expect(yield* cache.failedProviders()).not.toContain("apertis")
      expect(yield* cache.getFailure("apertis")).toBeUndefined()
    }),
  ),
)