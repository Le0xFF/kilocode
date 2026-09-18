import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Config } from "@/config/config"
import { MediaLocal, UpstreamError } from "../../../media-local/service"
import { MediaLocalFailedError } from "../../../media-local/group"

export const mediaLocalHandlers = HttpApiBuilder.group(InstanceHttpApi, "media-local", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service

    const imgModels = Effect.fn("MediaLocalHttpApi.imgModels")(function* () {
      const cfg = yield* config.get()
      return yield* MediaLocal.imgModels(cfg)
    })

    const imgGenerate = Effect.fn("MediaLocalHttpApi.imgGenerate")(function* (ctx: {
      payload: { prompt: string; model: string; size?: string; n?: number }
    }) {
      const cfg = yield* config.get()
      return yield* MediaLocal.generate({
        cfg,
        model: ctx.payload.model,
        prompt: ctx.payload.prompt,
        size: ctx.payload.size,
        n: ctx.payload.n,
      }).pipe(
        Effect.catchDefect((defect: unknown) =>
          defect instanceof UpstreamError ? Effect.fail(new MediaLocalFailedError({ message: defect.message })) : Effect.die(defect),
        ),
      )
    })

    return handlers.handle("imgModels", imgModels).handle("imgGenerate", imgGenerate)
  }),
)