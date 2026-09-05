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
      }),
    ),
  // kilocode_change - azure is outside the offline local surface; declared in config so it survives
  // the hard cut. `item.key` comes from the saved auth. The azure plugin loader was removed with the
  // online plugins, so `options.resourceName` (accountId/resourceName -> options) is gone: only the
  // credential itself persists, which is the canary this test guards.
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
        expect(item).toBeDefined()
      }),
    ),
  // kilocode_change - gitlab is outside the offline local surface; declared in config so it survives
  // the hard cut. The gitlab plugin loader was removed with the online plugins, so the oauth -> apiKey
  // options mapping is gone and the core api-key path only populates `key` for `type === "api"` creds.
  // Only the stored credential itself persists, which this test guards as a canary: the seeded entry
  // must still exist even though it carries no usable key/options offline.
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
      }),
    ),
  // kilocode_change - cloudflare-workers-ai is outside the offline local surface; declared in config so
  // it survives the hard cut. `item.key` comes from the saved auth. The cloudflare plugin loader was
  // removed with the online plugins, so `options.apiKey` and the accountId -> baseURL rewrite are gone:
  // only the credential itself persists, which is the canary this test guards.
  { config: { provider: { "cloudflare-workers-ai": {} } } },
)
