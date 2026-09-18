import { Schema } from "effect"
import * as path from "path"
import { Effect } from "effect"
import * as Tool from "./tool"
// kilocode_change - LSP removed; no language-server diagnostics on write
import { createTwoFilesPatch } from "diff"
import DESCRIPTION from "./write.txt"
import { EventV2Bridge } from "@/event-v2-bridge"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Format } from "../format"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { trimDiff, buildFileDiff } from "./edit" // kilocode_change
import { assertExternalDirectoryEffect } from "./external-directory"
import { ConfigValidation } from "../kilocode/config-validation" // kilocode_change
import * as EncodedIO from "../kilocode/tool/encoded-io" // kilocode_change
import { assertMutablePath } from "../kilocode/agent-manager/protection" // kilocode_change
import * as Bom from "@/util/bom"

export const Parameters = Schema.Struct({
  content: Schema.String.annotate({ description: "The content to write to the file" }),
  filePath: Schema.String.annotate({
    description: "The absolute path to the file to write (must be absolute, not relative)",
  }),
})

export const WriteTool = Tool.define(
  "write",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const events = yield* EventV2Bridge.Service
    const format = yield* Format.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { content: string; filePath: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(instance.directory, params.filePath)
          assertMutablePath(filepath) // kilocode_change
          yield* assertExternalDirectoryEffect(ctx, filepath)

          const exists = yield* fs.existsSafe(filepath)
          // kilocode_change start - encoding-aware read; Encoding.read strips UTF-8 BOMs so
          // derive the BOM flag from the detected encoding label instead of the decoded text.
          const pre = exists ? yield* EncodedIO.read(fs, filepath) : { text: "", encoding: "utf-8" }
          const source = { bom: pre.encoding === "utf-8-bom", text: pre.text, encoding: pre.encoding }
          // kilocode_change end
          const next = Bom.split(params.content)
          const desiredBom = source.bom || next.bom
          const contentOld = source.text
          const contentNew = next.text

          const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, contentNew))
          const filediff = buildFileDiff(filepath, contentOld, contentNew) // kilocode_change
          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(instance.worktree, filepath)],
            always: ["*"],
            metadata: {
              filepath,
              diff,
              filediff, // kilocode_change
            },
          })

          yield* EncodedIO.write(fs, filepath, Bom.join(contentNew, desiredBom), source.encoding) // kilocode_change - encoding-aware write (mkdirs) replaces fs.writeWithDirs
          if (yield* format.file(filepath)) {
            yield* EncodedIO.sync(fs, filepath, desiredBom, source.encoding)
          }
          yield* events.publish(FileSystem.Event.Edited, { file: filepath })
          yield* events.publish(Watcher.Event.Updated, {
            file: filepath,
            event: exists ? "change" : "add",
          })

          let output = "Wrote file successfully."
          // kilocode_change start - LSP removed; skip language-server diagnostic enrichment
          output += yield* Effect.promise(() => ConfigValidation.check(filepath)) // kilocode_change
          // kilocode_change end

          return {
            title: path.relative(instance.worktree, filepath),
            metadata: {
              diagnostics: {}, // kilocode_change - LSP removed; no per-file diagnostics
              filepath,
              exists: exists,
              diff, // kilocode_change
              filediff, // kilocode_change
            },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
