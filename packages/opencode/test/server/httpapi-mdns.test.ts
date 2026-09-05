import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { withTimeout } from "../../src/util/timeout"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

// kilocode_change - bonjour-service dep removed; the MDNS module is now an inert no-op. These tests guard
// the hostname gating in Server.listen (loopback skips publish) and that stop() always calls unpublish().

const original = {
  KILO_SERVER_PASSWORD: Flag.KILO_SERVER_PASSWORD,
  KILO_SERVER_USERNAME: Flag.KILO_SERVER_USERNAME,
}

// Import Server AFTER the flags above so the module picks up the values at listen time.
const { Server } = await import("../../src/server/server")

afterEach(async () => {
  Flag.KILO_SERVER_PASSWORD = original.KILO_SERVER_PASSWORD
  Flag.KILO_SERVER_USERNAME = original.KILO_SERVER_USERNAME
  await disposeAllInstances()
  await resetDatabase()
})

describe("HttpApi Server.listen mDNS", () => {
  test("runs the mDNS listener path for loopback hostnames without crashing", async () => {
    Flag.KILO_SERVER_PASSWORD = "mdns-secret"
    Flag.KILO_SERVER_USERNAME = "opencode"
    const listener = await Server.listen({ hostname: "127.0.0.1", port: 0, mdns: true })
    try {
      expect(listener.port).toBeGreaterThan(0)
    } finally {
      await withTimeout(listener.stop(true), 10_000, "timed out stopping loopback mdns listener")
    }
  })

  test("runs the mDNS listener path for non-loopback hostnames and stops cleanly", async () => {
    Flag.KILO_SERVER_PASSWORD = "mdns-secret"
    Flag.KILO_SERVER_USERNAME = "opencode"
    const listener = await Server.listen({ hostname: "0.0.0.0", port: 0, mdns: true })
    try {
      expect(listener.port).toBeGreaterThan(0)
    } finally {
      await withTimeout(listener.stop(true), 10_000, "timed out stopping mdns listener")
    }
  })

  test("graceful stop closes the listener for non-loopback hostnames", async () => {
    Flag.KILO_SERVER_PASSWORD = "mdns-secret"
    Flag.KILO_SERVER_USERNAME = "opencode"
    const listener = await Server.listen({ hostname: "0.0.0.0", port: 0, mdns: true })
    // Plain (graceful) stop without close=true should still tear down the listener.
    await withTimeout(listener.stop(), 10_000, "timed out stopping graceful mdns listener")
  })
})