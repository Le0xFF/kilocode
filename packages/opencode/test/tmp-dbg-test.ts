import { expect } from "bun:test"
import path from "path"
import { existsSync } from "fs"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../src/server/server"
import { AppRuntime } from "../src/effect/app-runtime"
import { ModelsDev } from "../src/provider/models"
import { tmpdir } from "./fixture/fixture"
import { it } from "./lib/effect"

void Log.init({ print: false })

const response = {
  acme: {
    id: "acme",
    name: "Acme",
    env: [],
    npm: "@ai-sdk/openai-compatible",
    api: "http://127.0.0.1:1/v1",
    models: {
      training: {
        id: "training",
        name: "Training",
        release_date: "2026-06-01",
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 128_000, output: 4096 },
        modalities: { input: ["text"], output: ["text"] },
        mayTrainOnYourPrompts: true,
      },
    },
  },
}

it.live("debug catalog visibility", Effect.gen(function* () {
  const server = yield* Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ port: 0, fetch(request) {
      if (new URL(request.url).pathname !== "/api.json") return new Response("not found", { status: 404 })
      return Response.json(response)
    }})),
    (server) => Effect.sync(() => server.stop(true)),
  )
  const source = `http://127.0.0.1:${server.port}`
  const flags = { disabled: Flag.KILO_DISABLE_MODELS_FETCH }
  // Warm up the lazy service graph before switching flags, like earlier tests do.
  const warmup = () =>
    Effect.promise(async () => {
      try {
        const value = await AppRuntime.runPromise(ModelsDev.Service.use((svc) => svc.get()))
        console.log("warmup:", Object.keys(value).length + " keys; acme? " + ("acme" in value))
      } catch (err) {
        console.log("warmup GET ERR " + String(err).slice(0, 200))
      }
    })
  yield* warmup()
  yield* Effect.sleep("300 millis")
  yield* Effect.acquireUseRelease(
    Effect.gen(function* () {
      Flag.KILO_DISABLE_MODELS_FETCH = true
      const file = path.join(Global.Path.cache, "models.json")
      yield* Effect.promise(() => Bun.write(file, JSON.stringify(response)))
    }),
    () => Effect.void,
    () => Effect.sync(() => {
      Flag.KILO_DISABLE_MODELS_FETCH = flags.disabled
    }),
  )
  const probe = (label: string) =>
    Effect.promise(async () => {
      try {
        const value = await AppRuntime.runPromise(ModelsDev.Service.use((svc) => svc.get()))
        console.log(label, Object.keys(value).length + " keys; acme? " + ("acme" in value))
      } catch (err) {
        console.log(label, "GET ERR " + String(err).slice(0, 200))
      }
    })
  yield* probe("after swap:")
  yield* Effect.sleep("500 millis")
  yield* probe("after wait:")
  const refresh = yield* Effect.promise(() =>
    AppRuntime.runPromise(ModelsDev.Service.use((svc) => svc.refresh(true))).then(
      () => "ok",
      (err) => "ERR " + String(err).slice(0, 300),
    ),
  )
  console.log("refresh result:", refresh)
  yield* probe("after forced refresh:")
}))