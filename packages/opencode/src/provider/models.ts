// kilocode_change - new file
import { Config } from "@/config/config"
import * as Core from "@opencode-ai/core/models-dev"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder" // kilocode_change

export const Model = Core.Model
export type Model = Core.Model
export const Provider = Core.Provider
export type Provider = Core.Provider
export const CatalogModelStatus = Core.CatalogModelStatus
export type CatalogModelStatus = Core.CatalogModelStatus

export interface Interface extends Core.Interface {}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelsDev") {}

export const layer: Layer.Layer<Service, never, Core.Service | Config.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const core = yield* Core.Service
    // kilocode_change start - apertis (online fetch to api.apertis.ai) and the anaconda-desktop overlay are excluded from the offline surface; drop both from the catalog so no online model-cache traffic is started
    const get = Effect.fn("ModelsDev.get")(function* () {
      const providers = yield* core.get()
      delete providers["apertis"]
      delete providers["anaconda-desktop"]
      return providers
    })
    // kilocode_change end

    return Service.of({ get, refresh: core.refresh })
  }),
)

export const defaultLayer: Layer.Layer<Service> = Layer.suspend(() => AppNodeBuilder.build(node)) // kilocode_change - build from the LayerNode graph

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Core.node, Config.node], // kilocode_change - apertis model-cache fetch removed with the offline catalog cut
})

export * as ModelsDev from "./models"
