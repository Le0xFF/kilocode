import path from "path"
import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { which } from "../util/which"

export namespace RipgrepBinary {
  interface Interface {
    readonly filepath: Effect.Effect<string, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/RipgrepBinary") {}

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service

      return Service.of({
        filepath: yield* Effect.cached(
          Effect.gen(function* () {
            // kilocode_change start - the offline fork resolves an explicit KILO_RIPGREP path first
            const override = process.env.KILO_RIPGREP
            if (override && (yield* fs.isFile(override).pipe(Effect.orDie))) return override
            // kilocode_change end
            // kilocode_change - Git for Windows may expose an incompatible MSYS rg.exe
            const system = yield* Effect.sync(() => (process.platform === "win32" ? undefined : which("rg")))
            if (system && (yield* fs.isFile(system).pipe(Effect.orDie))) return system

            const target = path.join(Global.Path.bin, `rg${process.platform === "win32" ? ".exe" : ""}`)
            if (yield* fs.isFile(target).pipe(Effect.orDie)) return target

            // kilocode_change start - on-demand download is disabled in the offline fork
            throw new Error(
              "ripgrep not found. On-demand download is disabled in the offline fork; install ripgrep on PATH, set KILO_RIPGREP, or use the VSIX-bundled binary.",
            )
            // kilocode_change end
          }),
        ),
      })
    }),
  )

  export const node = makeGlobalNode({
    service: Service,
    layer: layer,
    deps: [FSUtil.node],
  })
}
