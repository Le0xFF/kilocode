import { define } from "@kilocode/plugin/v2/effect/plugin"
import { Effect } from "effect"
import type { Scope } from "effect"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import type { PluginInternal } from "../internal"

export const OpenAIPlugin = define({
  id: "openai",
  effect: Effect.fn(function* (ctx) {
    // kilocode_change start - ChatGPT OAuth (auth.openai.com) is removed for the offline surface;
    // only the @ai-sdk/openai SDK wiring and catalog transform remain, so local openai-compatible
    // providers are unaffected and no auth.openai.com reference is ever registered.
    void ctx.integration
    // kilocode_change end
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.api.type !== "aisdk") continue
          if (item.provider.api.package !== "@ai-sdk/openai") continue
          if (!item.models.has(ModelV2.ID.make("gpt-5-chat-latest"))) continue
          evt.model.update(item.provider.id, ModelV2.ID.make("gpt-5-chat-latest"), (model) => {
            // OpenAIPlugin sends OpenAI models through Responses; this alias is a
            // chat-completions-only model, so hide it only from OpenAI's catalog.
            model.enabled = false
          })
        }
      }),
    )
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/openai") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/openai"))
        evt.sdk = mod.createOpenAI(evt.options)
      }),
    )
    yield* ctx.aisdk.language(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.openai) return
        evt.language = evt.sdk.responses(evt.model.api.id)
      }),
    )
  }),
} satisfies PluginInternal.Plugin<PluginInternal.Requirements | Scope.Scope>)
