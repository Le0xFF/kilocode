import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { ServerAuth } from "../../../src/server/auth"
import { HttpApiApp } from "../../../src/server/routes/instance/httpapi/server"
import { State, proxyHost } from "../../../src/kilocode/proxy-auth"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

const original = {
  password: Flag.KILO_SERVER_PASSWORD,
  username: Flag.KILO_SERVER_USERNAME,
  envPassword: process.env.KILO_SERVER_PASSWORD,
  envUsername: process.env.KILO_SERVER_USERNAME,
  httpsProxy: process.env.HTTPS_PROXY,
  httpProxy: process.env.HTTP_PROXY,
}

afterEach(async () => {
  Flag.KILO_SERVER_PASSWORD = original.password
  Flag.KILO_SERVER_USERNAME = original.username
  if (original.envPassword === undefined) delete process.env.KILO_SERVER_PASSWORD
  else process.env.KILO_SERVER_PASSWORD = original.envPassword
  if (original.envUsername === undefined) delete process.env.KILO_SERVER_USERNAME
  else process.env.KILO_SERVER_USERNAME = original.envUsername
  if (original.httpsProxy === undefined) delete process.env.HTTPS_PROXY
  else process.env.HTTPS_PROXY = original.httpsProxy
  if (original.httpProxy === undefined) delete process.env.HTTP_PROXY
  else process.env.HTTP_PROXY = original.httpProxy
  State.clear()
  await disposeAllInstances()
  await resetDatabase()
})

function app(input: { password?: string; username?: string }) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            KILO_SERVER_PASSWORD: input.password,
            KILO_SERVER_USERNAME: input.username,
            KILO_EXPERIMENTAL_DISABLE_FILEWATCHER: process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER ?? "true",
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler

  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return handler(
        input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
        HttpApiApp.context,
      )
    },
  }
}

function basic(username: string, password: string) {
  return ServerAuth.header({ username, password }) ?? ""
}

function setAuth(password: string) {
  Flag.KILO_SERVER_PASSWORD = password
  Flag.KILO_SERVER_USERNAME = undefined
  process.env.KILO_SERVER_PASSWORD = password
  delete process.env.KILO_SERVER_USERNAME
}

describe("POST /kilocode/proxy-auth endpoints", () => {
  test("set and clear report status and never leak credentials", async () => {
    await using tmp = await tmpdir({})
    process.env.HTTPS_PROXY = "http://proxy.example:3128"
    const route = (path: string) => `${path}?directory=${encodeURIComponent(tmp.path)}`
    const init = (body: unknown, authorization?: string): RequestInit => ({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kilo-directory": tmp.path,
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body),
    })
    const noAuth = app({})

    const set = await noAuth.request(route("/kilocode/proxy-auth/set"), init({ user: "svc", password: "hunter2" }))
    expect(set.status).toBe(200)
    const setBody = await set.json()
    expect(setBody).toEqual({ active: true, host: proxyHost(), mechanism: "basic" })
    expect(JSON.stringify(setBody)).not.toContain("hunter2")
    expect(State.active()).toBe(true)

    const snapshot = await noAuth.request(route("/kilocode/heap/snapshot"), init({}))
    expect(snapshot.status).toBe(409)
    const blocked = await snapshot.json()
    expect(blocked.message).toContain("proxy credentials")

    const clear = await noAuth.request(route("/kilocode/proxy-auth/clear"), init({}))
    expect(clear.status).toBe(200)
    expect(await clear.json()).toEqual({ active: false, host: proxyHost(), mechanism: null })
    expect(State.active()).toBe(false)

    const after = await noAuth.request(route("/kilocode/heap/snapshot"), init({}))
    expect(after.status).not.toBe(409)
  })

  test("defaults the mechanism to basic and rejects unsupported mechanisms with 501", async () => {
    await using tmp = await tmpdir({})
    const route = (path: string) => `${path}?directory=${encodeURIComponent(tmp.path)}`
    const init = (body: unknown): RequestInit => ({
      method: "POST",
      headers: { "content-type": "application/json", "x-kilo-directory": tmp.path },
      body: JSON.stringify(body),
    })
    const noAuth = app({})

    const defaulted = await noAuth.request(route("/kilocode/proxy-auth/set"), init({ password: "pw" }))
    expect(defaulted.status).toBe(200)
    expect((await defaulted.json()).mechanism).toBe("basic")

    const ntlm = await noAuth.request(route("/kilocode/proxy-auth/set"), init({ mechanism: "ntlm", password: "pw" }))
    expect(ntlm.status).toBe(501)
    const body = await ntlm.json()
    expect(body.mechanism).toBe("ntlm")
    expect(body.message).toContain("ntlm")
    expect(State.peek()?.mechanism).toBe("basic")
  })

  test("requires valid server credentials when a server password is configured", async () => {
    await using tmp = await tmpdir({})
    setAuth("secret")
    process.env.HTTPS_PROXY = "http://proxy.example:3128"
    const secured = app({ password: "secret" })
    const route = "/kilocode/proxy-auth/set?directory=" + encodeURIComponent(tmp.path)
    const init = (authorization?: string): RequestInit => ({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kilo-directory": tmp.path,
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify({ user: "svc", password: "hunter2" }),
    })

    expect((await secured.request(route, init())).status).toBe(401)
    expect((await secured.request(route, init(basic("kilo", "wrong")))).status).toBe(401)
    const valid = await secured.request(route, init(basic("kilo", "secret")))
    expect(valid.status).toBe(200)
    expect((await valid.json()).active).toBe(true)
  })
})
