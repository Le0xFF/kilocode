import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { describe, expect, test } from "bun:test"
import { Cause, ConfigProvider, Effect, Exit, Fiber, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Bus } from "../../../src/bus"
import * as Config from "../../../src/config/config"
import { AllowEverythingPermission } from "../../../src/kilocode/permission/allow-everything"
import { Permission } from "../../../src/permission"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { HttpApiApp } from "../../../src/server/routes/instance/httpapi/server"
import { provideTestInstance, tmpdir } from "../../fixture/fixture"
import { ServerAuth } from "../../../src/server/auth"
import { Session } from "../../../src/session/session"
import { provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const env = LayerNode.compile(
  LayerNode.group([
    Permission.node,
    Config.node,
    Session.node,
    SessionProjector.node,
    Bus.node,
    CrossSpawnSpawner.node,
  ]),
)
const it = testEffect(env)

const app = () => {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            KILO_SERVER_PASSWORD: "secret",
            KILO_SERVER_USERNAME: undefined,
            KILO_EXPERIMENTAL_DISABLE_FILEWATCHER: process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER ?? "true",
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler

  return (input: string | URL | Request, init?: RequestInit) =>
    handler(input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init), HttpApiApp.context)
}

const auth = () => ServerAuth.header({ username: "kilo", password: "secret" }) ?? ""

const ask = (input: Permission.AskInput) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

const reply = (input: Permission.ReplyInput) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.reply(input)
  })

const wait = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    for (let i = 0; i < 100; i++) {
      if ((yield* permission.list()).length > 0) return
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error("timed out waiting for pending permission request"))
  })

describe("AllowEverythingPermission", () => {
  test("handles disable requests through the HTTP endpoint", async () => {
    await using tmp = await tmpdir({ git: true })
    const request = app()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const blocked = await request("/permission/allow-everything", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
          body: JSON.stringify({ enable: true }),
        })
        expect(blocked.status).toBe(401)

        const enable = await request("/permission/allow-everything", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path, authorization: auth() },
          body: JSON.stringify({ enable: true }),
        })
        expect(enable.status).toBe(200)

        const disable = await request("/permission/allow-everything", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path, authorization: auth() },
          body: JSON.stringify({ enable: false }),
        })
        expect(disable.status).toBe(200)
        expect(await disable.json()).toBe(true)
      },
    })
  })

  it.live("disables global allow-all and restores permission prompts", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          expect(yield* AllowEverythingPermission.effect({ enable: true })).toBe(true)
          expect(yield* AllowEverythingPermission.effect({ enable: false })).toBe(true)

          const session = yield* sessions.create({})
          const pending = yield* ask({
            id: PermissionV1.ID.make("permission_global_disable"),
            sessionID: session.id,
            permission: "bash",
            patterns: ["ls"],
            metadata: {},
            always: [],
            ruleset: [],
          }).pipe(Effect.forkScoped)

          yield* wait()
          yield* reply({
            requestID: PermissionV1.ID.make("permission_global_disable"),
            reply: "reject",
          })

          const exit = yield* Fiber.await(pending)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.RejectedError)
          }
        }),
      { git: true },
    ),
  )

  it.live("disables session-scoped allow-all without affecting other sessions", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const session = yield* sessions.create({
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          expect(yield* AllowEverythingPermission.effect({ enable: true, sessionID: session.id })).toBe(true)
          expect(yield* AllowEverythingPermission.effect({ enable: false, sessionID: session.id })).toBe(true)

          const next = yield* sessions.get(session.id)
          expect(next.permission ?? []).toEqual([])

          const pending = yield* ask({
            id: PermissionV1.ID.make("permission_session_disable"),
            sessionID: session.id,
            permission: "bash",
            patterns: ["ls"],
            metadata: {},
            always: [],
            ruleset: [],
          }).pipe(Effect.forkScoped)

          yield* wait()
          yield* reply({
            requestID: PermissionV1.ID.make("permission_session_disable"),
            reply: "reject",
          })

          const exit = yield* Fiber.await(pending)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.RejectedError)
          }

          const other = yield* sessions.create({})
          const blocked = yield* ask({
            id: PermissionV1.ID.make("permission_other_session"),
            sessionID: other.id,
            permission: "bash",
            patterns: ["pwd"],
            metadata: {},
            always: [],
            ruleset: [],
          }).pipe(Effect.forkScoped)

          yield* wait()
          yield* reply({
            requestID: PermissionV1.ID.make("permission_other_session"),
            reply: "reject",
          })

          const blockedExit = yield* Fiber.await(blocked)
          expect(Exit.isFailure(blockedExit)).toBe(true)
          if (Exit.isFailure(blockedExit)) {
            expect(Cause.squash(blockedExit.cause)).toBeInstanceOf(Permission.RejectedError)
          }
        }),
      { git: true },
    ),
  )
})
