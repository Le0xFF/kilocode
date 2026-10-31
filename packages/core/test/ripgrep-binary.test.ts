import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Cause, Effect, Exit } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { RipgrepBinary } from "@opencode-ai/core/ripgrep/binary"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(RipgrepBinary.node))

const OFFLINE_ERROR =
  "ripgrep not found. On-demand download is disabled in the offline fork; install ripgrep on PATH, set KILO_RIPGREP, or use the VSIX-bundled binary."

// Point every resolution source at `bin` so the test is deterministic: no system `rg`,
// no global bin, and `KILO_RIPGREP` cleared (or set to `kilo`). Restores on scope exit.
const guard = (bin: string, kilo?: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const state = { bin: Global.Path.bin, path: process.env.PATH, kilo: process.env.KILO_RIPGREP }
      Global.Path.bin = bin
      process.env.PATH = bin
      if (kilo === undefined) delete process.env.KILO_RIPGREP
      else process.env.KILO_RIPGREP = kilo
      return state
    }),
    (state) =>
      Effect.sync(() => {
        Global.Path.bin = state.bin
        if (state.path === undefined) delete process.env.PATH
        else process.env.PATH = state.path
        if (state.kilo === undefined) delete process.env.KILO_RIPGREP
        else process.env.KILO_RIPGREP = state.kilo
      }),
  )

describe("RipgrepBinary", () => {
  it.live("throws the offline error when no binary can be resolved", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const empty = yield* Effect.promise(() => fs.mkdtemp(path.join(tmp.path, "bin-")))
          yield* guard(empty)
          const exit = yield* (yield* RipgrepBinary.Service).filepath.pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
          const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty
          expect(Cause.prettyErrors(cause).map((err) => err.message)).toContain(OFFLINE_ERROR)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("resolves the KILO_RIPGREP override before the system and global bins", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const empty = yield* Effect.promise(() => fs.mkdtemp(path.join(tmp.path, "bin-")))
          const override = path.join(tmp.path, "rg")
          yield* Effect.promise(() =>
            fs.writeFile(override, `#!${process.execPath}\nprocess.stdout.write("ok")\n`, { mode: 0o755 }),
          )
          yield* guard(empty, override)
          const resolved = yield* (yield* RipgrepBinary.Service).filepath
          expect(resolved).toBe(override)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
