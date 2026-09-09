// kilocode_change - new file
import { Context, Effect, Layer } from "effect"
// kilocode_change - apertis removed: the cache no longer performs HTTP model fetches (HttpClient dropped)
import { Config } from "../config/config"


import * as Log from "@opencode-ai/core/util/log"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder" // kilocode_change

type Failure = { message: string }

export interface Interface {
  readonly getFailure: (providerID: string) => Effect.Effect<Failure | undefined>
  readonly failedProviders: () => Effect.Effect<string[]>
  readonly clear: (providerID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/ModelCache") {}

const log = Log.create({ service: "model-cache" })

// kilocode_change start - apertis removed: the online model fetch (fetchApertisModels + APERTIS_* env) and the
// fetch/refresh/get cell machinery are gone; only provider failure-state tracking remains so
// clear/failedProviders keep working for both providers and tests.
export const layer = Layer.effect(Service, Effect.gen(function* () {
  const cfg = yield* Config.Service
  const failures = new Map<string, Failure>()

  const getFailure = Effect.fn("ModelCache.getFailure")(function* (providerID: string) {
    return failures.get(providerID)
  })

  const failedProviders = Effect.fn("ModelCache.failedProviders")(function* () {
    return [...failures.keys()]
  })


  const clear = Effect.fn("ModelCache.clear")(function* (providerID: string) {
    failures.delete(providerID)
    const item = (yield* cfg.get()).provider?.[providerID]
    if (item?.models) {
      log.info("cache cleared", { providerID })
      return

    }
    log.debug("no cache to clear", { providerID })
  })


  return Service.of({ getFailure, failedProviders, clear })
}),

)
// kilocode_change end

export const defaultLayer = Layer.suspend(() => AppNodeBuilder.build(node)) // kilocode_change - build from the LayerNode graph

// kilocode_change - apertis removed: only the Config dep remains (resolves the provider model surface); no HTTP fetch
export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node],
})

export * as ModelCache from "./model-cache"