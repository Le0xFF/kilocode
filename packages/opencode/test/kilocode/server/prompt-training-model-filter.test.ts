import { afterEach, expect } from "bun:test"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../../src/server/server"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"
import { resetDatabase } from "../../fixture/db"
import { it } from "../../lib/effect"

void Log.init({ print: false })

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function models(input: unknown, key: "all" | "providers") {
  if (!record(input) || !Array.isArray(input[key])) return []
  const mine = input[key].find((provider) => record(provider) && provider.id === "mylocal")
  if (!record(mine) || !record(mine.models)) return []
  return Object.keys(mine.models)
}

function request(path: string, dir: string) {
  return Effect.promise(async () => {
    const result = await Server.Default().app.request(path, { headers: { "x-kilo-directory": dir } })
    expect(result.status).toBe(200)
    return result.json()
  })
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

it.live(
  "filters prompt-training models from both provider catalogs",
  Effect.gen(function* () {
    const model = (id: string, name: string, mayTrainOnYourPrompts: boolean) => ({
      id,
      name,
      attachment: false,
      reasoning: false,
      temperature: false,
      tool_call: true,
      release_date: "2025-01-01",
      limit: { context: 100_000, output: 10_000 },
      cost: { input: 0, output: 0 },
      mayTrainOnYourPrompts,
      options: {},
    })
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() =>
        tmpdir({
          config: {
            formatter: false,
            hide_prompt_training_models: true,
            provider: {
              mylocal: {
                name: "My Local",
                npm: "@ai-sdk/openai-compatible",
                env: [],
                models: {
                  training: model("training", "Training", true),
                  private: model("private", "Private", false),
                },
                options: { apiKey: "test-key", baseURL: "http://localhost:11434/v1" },
              },
            },
          },
        }),
      ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )

    const all = yield* request("/provider", tmp.path)
    const connected = yield* request("/config/providers", tmp.path)

    expect(models(all, "all")).toEqual(["private"])
    expect(models(connected, "providers")).toEqual(["private"])
  }),
)