import { define } from "./internal"
import { Effect, Stream } from "effect"
import { EventV2 } from "../event"
import { ModelsDev } from "../models-dev"

// kilocode_change start - neutralized: the offline catalog cut (Step 3) removed every built-in online
// provider, so the full-catalog integration/catalog transforms add nothing. The models.dev refresh
// subscription is kept so reload events still flow through the pipeline.
export const ModelsDevPlugin = define({
  id: "models-dev",
  effect: Effect.fn(function* (ctx) {
    const modelsDev = yield* ModelsDev.Service
    const events = yield* EventV2.Service
    void modelsDev
    yield* events.subscribe(ModelsDev.Event.Refreshed).pipe(
      Stream.runForEach(() => ctx.integration.reload().pipe(Effect.andThen(ctx.catalog.reload()))),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
// kilocode_change end
