import { describe, expect, it } from "bun:test"
import type { Config } from "@kilocode/sdk/v2/client"

const { KiloProvider } = await import("../../src/KiloProvider")

// kilocode_change - offline fork: the gateway organization/account surface was
// removed. The catalog refresh mechanics below (coalescing, invalidation, disposal
// re-fetch) still exist and are exercised here, but they no longer carry an
// organizationId / ready / notification pipeline. Assertions target the offline
// providersLoaded message shape (providers + connected + defaults + defaultSelection).
const external = { id: "external", name: "External", models: { model: { id: "model" } } }
const local = { id: "local", name: "Local", models: { llama: { id: "llama" }, qwen: { id: "qwen" } } }
const catalog = () => ({
  data: {
    all: [local, external],
    connected: ["local", "external"],
    default: { local: "qwen", external: "model" },
  },
})

type Internals = {
  connectionState: string
  cachedConfigMessage: unknown
  cachedProvidersMessage: unknown
  providersRefresh: Promise<void> | null
  fetchAndSendProviders(): Promise<void>
  invalidateProviders(): void
  handleEvent(event: unknown, directory?: string): void
  reloadAfterAuthChange(): Promise<void>
}

function setup(list: () => Promise<ReturnType<typeof catalog>>) {
  const client = {
    provider: { list, auth: async () => ({ data: {} }) },
    kilo: undefined,
    config: {
      get: async (): Promise<{ data: Config }> => ({ data: {} }),
      overlay: async () => ({ data: {} }),
    },
    global: { config: { get: async () => ({ data: {} }) } },
    experimental: { capabilities: { get: async () => ({ data: {} }) } },
  }
  const provider = new KiloProvider(
    {} as never,
    { getClient: () => client, resolveEventSessionId: () => undefined } as never,
  )
  const internal = provider as unknown as Internals
  Object.assign(internal, {
    connectionState: "connected",
    fetchAndSendAgents: async () => {},
    fetchAndSendSkills: async () => {},
    fetchAndSendCommands: async () => {},
    fetchAndSendIndexingStatus: async () => {},
    fetchAndSendNotifications: async () => {},
  })
  const reloads: Promise<void>[] = []
  const reload = internal.reloadAfterAuthChange.bind(internal)
  internal.reloadAfterAuthChange = () => {
    const task = reload()
    reloads.push(task)
    return task
  }
  const messages: Array<Record<string, unknown>> = []
  provider.postMessage = (message) => void messages.push(message as Record<string, unknown>)
  return { internal, messages, client, reloads }
}

describe("KiloProvider catalog refresh", () => {
  it("invalidates cached provider data before another refresh", async () => {
    const { internal, messages } = setup(async () => catalog())
    await internal.fetchAndSendProviders()
    expect(internal.cachedProvidersMessage).toMatchObject({ type: "providersLoaded" })

    internal.invalidateProviders()

    expect(internal.cachedProvidersMessage).toBeNull()
    expect(messages.at(-1)).toEqual({ type: "providersLoading" })
  })

  it("publishes only the newest catalog after a queued refresh", async () => {
    const first = Promise.withResolvers<ReturnType<typeof catalog>>()
    const started = Promise.withResolvers<void>()
    let calls = 0
    const { internal, messages } = setup(async () => {
      calls++
      if (calls !== 1) return catalog()
      started.resolve()
      return first.promise
    })

    const before = internal.fetchAndSendProviders()
    await started.promise
    // A second fetch is issued while the first is still in flight; only the
    // most recent result should be published.
    const after = internal.fetchAndSendProviders()
    first.resolve(catalog())
    await Promise.all([before, after])

    expect(calls).toBe(2)
    expect(messages).toHaveLength(1)
    expect(messages.at(0)).toMatchObject({
      type: "providersLoaded",
      defaults: { local: "qwen", external: "model" },
      providers: { local: { models: { qwen: { id: "qwen" } } }, external },
    })
  })

  it.each([false, true])("preserves a queued refresh through invalidation (failure: %s)", async (fail) => {
    const first = Promise.withResolvers<ReturnType<typeof catalog>>()
    let calls = 0
    const { internal, messages } = setup(async () => (++calls === 1 ? first.promise : catalog()))
    const before = internal.fetchAndSendProviders()
    const queued = internal.fetchAndSendProviders()

    internal.invalidateProviders()
    if (fail) first.reject(new Error("Old catalog unavailable"))
    if (!fail) first.resolve(catalog())
    await Promise.all([before, queued])

    expect(calls).toBe(2)
    expect(messages).toHaveLength(2)
    expect(messages.at(0)).toEqual({ type: "providersLoading" })
    expect(messages.at(-1)).toMatchObject({
      type: "providersLoaded",
      defaults: { local: "qwen", external: "model" },
      providers: { local: { models: { qwen: { id: "qwen" } } }, external },
    })
  })

  it.each(["global.disposed", "server.instance.disposed"])(
    "%s restores a fresh catalog without waiting for config",
    async (type) => {
      const config = Promise.withResolvers<{ data: Config }>()
      const { internal, messages, client, reloads } = setup(async () => catalog())
      const preference = { model: "external/model" }
      internal.cachedConfigMessage = { config: preference }
      client.config.get = () => config.promise
      await internal.fetchAndSendProviders()
      const fresh = internal.cachedProvidersMessage

      internal.handleEvent(
        { type, properties: { directory: "/repo" } },
        type === "global.disposed" ? "global" : "/repo",
      )
      try {
        expect(messages.at(-1)).toEqual({ type: "providersLoading" })
        expect(internal.providersRefresh).not.toBeNull()
        await internal.providersRefresh

        expect(internal.cachedProvidersMessage).toEqual(fresh)
        expect(messages.at(-1)).toMatchObject({
          type: "providersLoaded",
          providers: { local, external },
          defaultSelection: { providerID: "external", modelID: "model" },
        })
        expect(messages.some((message) => message.type === "configLoaded")).toBe(false)
        expect(internal.cachedConfigMessage).toEqual({ config: preference })
      } finally {
        config.resolve({ data: preference })
        await Promise.all(reloads)
      }
      expect(internal.cachedProvidersMessage).toEqual(fresh)
    },
  )

  it("disposal invalidates every view and retries only the delayed catalog while config is delayed", async () => {
    const config = Promise.withResolvers<{ data: Config }>()
    const first = Promise.withResolvers<ReturnType<typeof catalog>>()
    let delayed = false
    const views = Array.from({ length: 2 }, () => setup(async () => (delayed ? first.promise : catalog())))
    await Promise.all(views.map((view) => view.internal.fetchAndSendProviders()))
    delayed = true
    const pending = views.map((view) => view.internal.fetchAndSendProviders())
    const queued = views.map((view) => view.internal.fetchAndSendProviders())
    views.at(0)!.internal.invalidateProviders()
    for (const view of views) {
      view.client.config.get = () => config.promise
      view.internal.handleEvent({ type: "global.disposed", properties: {} }, "global")
      expect(view.internal.cachedProvidersMessage).toBeNull()
      expect(view.messages.at(-1)).toEqual({ type: "providersLoading" })
    }
    first.resolve(catalog())
    try {
      await Promise.all([...pending, ...queued])
      for (const view of views) {
        expect(view.messages.filter((message) => message.type === "providersLoaded")).toHaveLength(2)
        expect(view.internal.cachedProvidersMessage).toMatchObject({
          defaults: { local: "qwen", external: "model" },
          providers: { local: { models: { qwen: { id: "qwen" } } }, external },
        })
        expect(view.messages.some((message) => message.type === "configLoaded")).toBe(false)
      }
    } finally {
      config.resolve({ data: {} })
      await Promise.all(views.flatMap((view) => view.reloads))
    }
  })

  it("cannot republish an in-flight old catalog after invalidation", async () => {
    const first = Promise.withResolvers<ReturnType<typeof catalog>>()
    const { internal, messages } = setup(() => first.promise)
    const pending = internal.fetchAndSendProviders()

    internal.invalidateProviders()
    first.resolve(catalog())
    await pending

    expect(messages).toEqual([{ type: "providersLoading" }])
    expect(internal.cachedProvidersMessage).toBeNull()
  })

  it("does not restore an old catalog when the next fetch cannot load", async () => {
    let fail = false
    const { internal, messages } = setup(async () => {
      if (fail) throw new Error("Catalog unavailable")
      return catalog()
    })
    await internal.fetchAndSendProviders()
    internal.invalidateProviders()
    fail = true
    await internal.fetchAndSendProviders()

    expect(messages.at(-1)).toEqual({ type: "providersLoading" })
    expect(messages.filter((message) => message.type === "providersLoaded")).toHaveLength(1)
    expect(internal.cachedProvidersMessage).toBeNull()
  })
})