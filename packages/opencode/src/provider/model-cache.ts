// kilocode_change - new file
import { Cause, Context, Deferred, Duration, Effect, Exit, Layer, Option, Scope } from "effect"
// kilocode_change - apertis removed: the cache no longer performs HTTP model fetches (HttpClient dropped)
import type { Provider } from "@opencode-ai/core/models-dev"
import { Config } from "../config/config"
import * as Log from "@opencode-ai/core/util/log"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder" // kilocode_change

type Models = Provider["models"]
type Failure = { message: string }
type Options = { baseURL?: string; apiKey?: string }
type View = { models?: Models; timestamp?: number }
type Flight = { readonly done: Deferred.Deferred<Models, unknown>; version: number }

type Cell = {
  readonly providerID: string
  readonly options: Options
  readonly view: View
  cached?: { readonly result: Models; readonly expires: number }
  flight?: Flight
}

export interface Interface {
  readonly getFailure: (providerID: string) => Effect.Effect<Failure | undefined>
  readonly failedProviders: () => Effect.Effect<string[]>
  readonly get: (providerID: string) => Effect.Effect<Models | undefined>
  readonly fetch: (providerID: string, options?: Options) => Effect.Effect<Models, unknown>
  readonly refresh: (providerID: string, options?: Options) => Effect.Effect<Models, unknown>
  readonly clear: (providerID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/ModelCache") {}

const log = Log.create({ service: "model-cache" })
const ttl = Duration.minutes(5)

// kilocode_change start - apertis removed: no HTTP fetch (HttpClient dropped); only config resolves the model surface
export const layer = Layer.effect(Service, Effect.gen(function* () {
  const cfg = yield* Config.Service
  const scope = yield* Scope.Scope
// kilocode_change end
  const cells = new Map<string, Cell>()
  const active = new Map<string, Cell>()
  const versions = new Map<string, number>()
  const failures = new Map<string, Failure>()

  const getFailure = Effect.fn("ModelCache.getFailure")(function* (providerID: string) {
    return failures.get(providerID)
  })

  const failedProviders = Effect.fn("ModelCache.failedProviders")(function* () {
    return [...failures.keys()]
  })

  // kilocode_change start - apertis removed: the online model fetch (fetchApertisModels + APERTIS_* env) is gone.
  // load() resolves each provider's model surface from config; a provider with no configured models is treated
  // as a failed load (records failure state), so clear/failedProviders keep working for both providers and tests.
  const load = Effect.fn("ModelCache.load")(function* (providerID: string, _options: Options) {
    // kilocode_change - apertis online model fetch removed; a provider with no configured models is a failed load.
    const item = (yield* cfg.get()).provider?.[providerID]
    if (!item?.models) return yield* Effect.fail(new Error(`no models configured for ${providerID}`))
    return {}
  })
  // kilocode_change end

  const key = (providerID: string, options?: Options) => JSON.stringify([providerID, options?.baseURL, options?.apiKey])

  const cell = Effect.fn("ModelCache.cell")(function* (providerID: string, options: Options = {}) {
    const id = key(providerID, options)
    const existing = cells.get(id)
    if (existing) return existing
    const view: View = {}
    const next: Cell = { providerID, options, view }
    cells.set(id, next)
    return next
  })

  const invalidate = (entry: Cell) =>
    Effect.sync(() => {
      entry.cached = undefined
    })

  const detach = (entry: Cell) =>
    invalidate(entry).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          entry.flight = undefined
        }),
      ),
    )

  const commit = (providerID: string, version: number, entry: Cell, models: Models) =>
    Effect.sync(() => {
      if ((versions.get(providerID) ?? 0) !== version) return models
      failures.delete(providerID)
      entry.view.models = models
      entry.view.timestamp = Date.now()
      active.set(providerID, entry)
      log.info("models fetched and cached", { providerID, count: Object.keys(models).length })
      return models
    })

  // A refresh belongs to the cache service, not the caller that happened to start it.
  const evaluate = (entry: Cell, version: number) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const cached = entry.cached
        if (cached && cached.expires > Date.now()) {
          yield* commit(entry.providerID, version, entry, cached.result)
          return cached.result
        }

        const existing = entry.flight
        if (existing) {
          existing.version = version
          return yield* restore(Deferred.await(existing.done))
        }

        const done = yield* Deferred.make<Models, unknown>()
        const flight = { done, version } satisfies Flight
        entry.flight = flight
        yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const exit = yield* restore(load(entry.providerID, entry.options)).pipe(Effect.exit)
            if (entry.flight === flight) {
              entry.flight = undefined
              if (Exit.isSuccess(exit)) {
                entry.cached = { result: exit.value, expires: Date.now() + Duration.toMillis(ttl) }
                yield* commit(entry.providerID, flight.version, entry, exit.value)
              } else {
                const cause = Exit.getCause(exit).pipe(Option.getOrElse(() => Cause.empty))
                failures.set(entry.providerID, { message: String(Cause.squash(cause)) })
              }
            }
            yield* Deferred.done(done, exit)
          }),
        ).pipe(Effect.forkIn(scope, { startImmediately: true }))
        return yield* restore(Deferred.await(done))
      }),
    )

  const get = Effect.fn("ModelCache.get")(function* (providerID: string) {
    const entry = active.get(providerID)
    if (!entry?.view.models || entry.view.timestamp === undefined) {
      log.debug("cache miss", { providerID })
      return
    }

    const age = Date.now() - entry.view.timestamp
    if (age > Duration.toMillis(ttl)) {
      log.debug("cache expired", { providerID, age })
      entry.view.models = undefined
      entry.view.timestamp = undefined
      yield* invalidate(entry)
      return
    }

    log.debug("cache hit", { providerID, age })
    return entry.view.models
  })

  const fetch = Effect.fn("ModelCache.fetch")(function* (providerID: string, options?: Options) {
    const cached = yield* get(providerID)
    if (cached) return cached
    const version = (versions.get(providerID) ?? 0) + 1
    versions.set(providerID, version)
    const entry = yield* cell(providerID, options)
    log.info("fetching models", { providerID })
    const result = yield* evaluate(entry, version)
    return result
  })

  const refresh = Effect.fn("ModelCache.refresh")(function* (providerID: string, options?: Options) {
    const version = (versions.get(providerID) ?? 0) + 1
    versions.set(providerID, version)
    const entry = yield* cell(providerID, options)
    log.info("refreshing models", { providerID })
    yield* invalidate(entry)
    const result = yield* evaluate(entry, version)
    return result
  })

  const clear = Effect.fn("ModelCache.clear")(function* (providerID: string) {
    versions.set(providerID, (versions.get(providerID) ?? 0) + 1)
    const entries = [...cells.entries()].filter(([, entry]) => entry.providerID === providerID)
    yield* Effect.all(
      entries.map(([id, entry]) => detach(entry).pipe(Effect.tap(() => Effect.sync(() => cells.delete(id))))),
      { discard: true },
    )
    active.delete(providerID)
    failures.delete(providerID)
    if (entries.some(([, entry]) => entry.view.models)) {
      log.info("cache cleared", { providerID })
      return
    }
    log.debug("no cache to clear", { providerID })
  })

  return Service.of({ getFailure, failedProviders, get, fetch, refresh, clear })
}),
)

export const defaultLayer = Layer.suspend(() => AppNodeBuilder.build(node)) // kilocode_change - build from the LayerNode graph

// kilocode_change - apertis removed: only the Config dep remains (resolves the provider model surface); no HTTP fetch
export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node],
})

export * as ModelCache from "./model-cache"