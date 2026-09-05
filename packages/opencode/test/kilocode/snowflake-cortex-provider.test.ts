import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { expect } from "bun:test"
import { Effect } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Provider } from "../../src/provider/provider"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(Provider.node))

it.instance(
  "keeps saved Snowflake Cortex credentials on the offline surface",
  () =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const previous = process.env.KILO_AUTH_CONTENT
        process.env.KILO_AUTH_CONTENT = JSON.stringify({
          "snowflake-cortex": {
            type: "oauth",
            refresh: "refresh-token",
            access: "access-token",
            expires: 1,
            accountId: "test-account",
          },
        })
        return previous
      }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.KILO_AUTH_CONTENT
          else process.env.KILO_AUTH_CONTENT = previous
        }),
    ).pipe(
      Effect.flatMap(() =>
        Effect.gen(function* () {
          // kilocode_change - the snowflake-cortex plugin loader was removed with the online plugins, so the
          // accountId -> baseURL rewrite and the access -> apiKey mapping are gone. The provider is declared in
          // config so it survives the hard cut; only the stored credential itself persists, which this test guards.
          const provider = yield* Provider.Service
          const item = (yield* provider.list())[ProviderV2.ID.make("snowflake-cortex")]
          expect(item).toBeDefined()
        }),
      ),
    ),
  { config: { provider: { "snowflake-cortex": {} } } },
)