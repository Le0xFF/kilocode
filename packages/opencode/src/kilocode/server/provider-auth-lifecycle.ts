import { InstanceStore } from "@/project/instance-store"
import { ModelCache } from "@/provider/model-cache"
import { Effect } from "effect"

export const disposeAllInstancesAfterProviderAuthCallback = (store: InstanceStore.Interface) =>
  store.disposeAll()

// kilocode_change start - no-op kept for handler call-sites that used to drop the presence socket on kilo auth changes
export const invalidatePresence = (): Effect.Effect<void, never, never> => Effect.succeed(undefined)
// kilocode_change end

export const invalidateAfterProviderAuthChange = (
  providerID: string,
): Effect.Effect<void, never, ModelCache.Service | InstanceStore.Service> =>
  Effect.gen(function* () {
    const cache = yield* ModelCache.Service
    const store = yield* InstanceStore.Service
    yield* cache.clear(providerID)
    yield* disposeAllInstancesAfterProviderAuthCallback(store)
  })