import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { makeRuntime } from "@/effect/run-service"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"

const config = makeRuntime(Config.Service, AppNodeBuilder.build(Config.node))
const auth = makeRuntime(Auth.Service, Auth.defaultLayer)

export namespace KiloCliBootstrapRuntime {
  export function getGlobal() {
    return config.runPromise((service) => service.getGlobal())
  }

  export function getAuth() {
    return auth.runPromise((service) => service.get("kilo"))
  }

  export function setAuth(info: Auth.Info) {
    return auth.runPromise((service) => service.set("kilo", info))
  }

  export async function dispose() {
    await Promise.all([config.dispose(), auth.dispose()])
  }
}