import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"

const status = () => ({ enabled: false, connected: false })

export const remoteHandlers = HttpApiBuilder.group(InstanceHttpApi, "remote", (handlers) =>
  Effect.gen(function* () {
    const enable = Effect.fn("RemoteHttpApi.enable")(function* () {
      yield* Effect.fail(new HttpApiError.Unauthorized())
      return status()
    })

    const disable = Effect.fn("RemoteHttpApi.disable")(function* () {
      return status()
    })

    const probe = Effect.fn("RemoteHttpApi.status")(function* () {
      return status()
    })

    return handlers.handle("enable", enable).handle("disable", disable).handle("status", probe)
  }),
)