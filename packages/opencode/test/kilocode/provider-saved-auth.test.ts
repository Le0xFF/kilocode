import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { expect } from "bun:test"
import { Effect } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Provider } from "../../src/provider/provider"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(Provider.node))

const auth = <A, E, R>(value: Record<string, unknown>, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.KILO_AUTH_CONTENT
      process.env.KILO_AUTH_CONTENT = JSON.stringify(value)
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.KILO_AUTH_CONTENT
        else process.env.KILO_AUTH_CONTENT = previous
      }),
  )

it.instance(
  "uses saved Azure resource metadata",
  () =>
    auth(
      { azure: { type: "api", key: "azure-key", metadata: { resourceName: "saved-resource" } } },
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const item = (yield* provider.list())[ProviderV2.ID.make("azure")]
        expect(item.key).toBe("azure-key")
        expect(item.options.resourceName).toBe("saved-resource")
      }),
    ),
  // kilocode_change - azure is outside the offline local surface; declared in config so it survives
  // the hard cut. `item.key` now comes from the saved auth, but `options.resourceName` was populated
  // by the removed azure plugin loader (accountId/resourceName -> options), which no longer exists.
  // Failing until that loader is re-added or the assertion is re-pointed.
  { config: { provider: { azure: {} } } },
)

it.instance(
  "uses saved GitLab OAuth access",
  () =>
    auth(
      { gitlab: { type: "oauth", refresh: "refresh", access: "oauth-access", expires: Date.now() + 60_000 } },
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const item = (yield* provider.list())[ProviderV2.ID.make("gitlab")]
        expect(item.options.apiKey).toBe("oauth-access")
      }),
    ),
  // kilocode_change - gitlab is outside the offline local surface; declared in config so it survives
  // the hard cut. The oauth -> apiKey mapping came from the removed gitlab plugin loader, but this
  // assertion still passes because the core api-key path populates `options.apiKey` from the saved
  // credential's access token. Kept as a canary for the saved-oauth wiring.
  { config: { provider: { gitlab: {} } } },
)

it.instance(
  "uses saved Cloudflare Workers AI account metadata",
  () =>
    auth(
      {
        "cloudflare-workers-ai": {
          type: "api",
          key: "cloudflare-key",
          metadata: { accountId: "saved-account" },
        },
      },
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const item = (yield* provider.list())[ProviderV2.ID.make("cloudflare-workers-ai")]
        expect(item.key).toBe("cloudflare-key")
        expect(item.options.apiKey).toBe("cloudflare-key")
        const model = Object.values(item.models)[0]
        const language = yield* provider.getLanguage(model)
        const url = (
          language as unknown as { config: { url: (input: { path: string; modelId: string }) => string } }
        ).config.url({ path: "/chat/completions", modelId: model.id })
        expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/saved-account/ai/v1/chat/completions")
      }),
    ),
  // kilocode_change - cloudflare-workers-ai is outside the offline local surface; declared in config so
  // it survives the hard cut. `item.key` comes from the saved auth, but `options.apiKey` and the
  // accountId -> baseURL rewrite were provided by the removed cloudflare plugin loader, which no
  // longer exists. Failing until that loader is re-added or the assertions are re-pointed.
  { config: { provider: { "cloudflare-workers-ai": {} } } },
)
