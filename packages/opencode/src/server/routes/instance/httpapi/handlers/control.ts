import { Auth } from "@/auth"
// kilocode_change start
import { invalidateAfterProviderAuthChange, invalidatePresence } from "@/kilocode/server/provider-auth-lifecycle"
import { InstanceStore } from "@/project/instance-store"
import { ModelCache } from "@/provider/model-cache"
// kilocode_change end
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { remove as removeAuth } from "@/kilocode/auth/remove" // kilocode_change

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service

    const authSet = (ctx: { params: { providerID: ProviderV2.ID }; payload: Auth.Info }) =>
      Effect.gen(function* () {
        yield* auth.set(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
        // kilocode_change start - drop old presence socket before instance disposal on Kilo auth changes
        if (ctx.params.providerID === "kilo") yield* invalidatePresence()
        yield* invalidateAfterProviderAuthChange(ctx.params.providerID)
        // kilocode_change end
        return true
      })

    const authRemove = (ctx: { params: { providerID: ProviderV2.ID } }) =>
      Effect.gen(function* () {
        // kilocode_change start
        yield* removeAuth(ctx.params.providerID)
        if (ctx.params.providerID === "kilo") yield* invalidatePresence()
        yield* invalidateAfterProviderAuthChange(ctx.params.providerID)
        // kilocode_change end
        return true
      })

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const write =
        ctx.payload.level === "debug"
          ? Effect.logDebug
          : ctx.payload.level === "info"
            ? Effect.logInfo
            : ctx.payload.level === "warn"
              ? Effect.logWarning
              : Effect.logError
      yield* write(ctx.payload.message).pipe(Effect.annotateLogs(ctx.payload.extra ?? {}))
      return true
    })

    return handlers.handle("authSet", authSet).handle("authRemove", authRemove).handle("log", log)
  }),
)
