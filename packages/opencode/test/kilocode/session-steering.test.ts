import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Config } from "@/config/config"
import { Provider as ProviderSvc } from "@/provider/provider"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Command } from "../../src/command"
import { Env } from "../../src/env"
import { Format } from "../../src/format"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Question } from "../../src/question"
import { Snapshot } from "../../src/snapshot"
import { Skill } from "../../src/skill"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { SystemPrompt } from "../../src/session/system"
import { Todo } from "../../src/session/todo"
import { BoardStore } from "../../src/kilocode/board/store"
import { KiloSessionSteering } from "../../src/kilocode/session/steering"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const plugin = Layer.mock(Plugin.Service)({
  trigger: <Output>(_name: string, _input: unknown, output: Output) => Effect.succeed(output),
  list: () => Effect.succeed([]),
  init: () => Effect.void,
})

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    resourceTemplates: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in steering test"),
    authenticate: () => Effect.die("unexpected MCP auth in steering test"),
    finishAuth: () => Effect.die("unexpected MCP auth in steering test"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const memory = LayerNode.make({ service: MemoryService.Service, layer: MemoryService.layer, deps: [] })
const server = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })
const runtimeFlags = RuntimeFlags.layer({ experimentalEventSystem: true })
// Mirror the fork's prompt.test.ts root group: the upstream minimal group predates the fork's
// Kilo session-graph deltas and is missing nodes our SessionPrompt graph requires (Env, LLM, ...).
const root = LayerNode.group([
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  SessionStatus.node,
  SessionRunState.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  Truncate.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
  memory,
  server,
])

const it = testEffect(
  LayerNode.compile(root, [
    [SessionSummary.node, summary],
    [Plugin.node, plugin],
    [MCP.node, mcp],
    [RuntimeFlags.node, runtimeFlags],
  ]),
)

const cfg = {
  model: "test/test-model",
  enabled_providers: ["test"],
  snapshot: false,
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
  shared_agent_board: true,
}

function config(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: { ...cfg.provider.test.options, baseURL: url },
      },
    },
  }
}

const steer = (text: string) => ({ type: "text" as const, text, metadata: { kind: KiloSessionSteering.KIND } })

test("fits escape-heavy steering text inside the board message budget", () => {
  for (const text of ["\u0001".repeat(3000), '"\\'.repeat(2000), "x".repeat(9000)]) {
    const body = KiloSessionSteering.body(text)
    expect(body.startsWith("The user steered this subagent directly:")).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(3584)
  }
  expect(KiloSessionSteering.body("short")).toBe("The user steered this subagent directly:\n\nshort")
})

test("only counts marked human text as steering", () => {
  expect(
    KiloSessionSteering.text([
      { type: "text", text: "task prompt from the parent" },
      { type: "text", text: "editor context", synthetic: true, metadata: { kind: KiloSessionSteering.KIND } },
      { type: "file" },
      steer("inspect the parser"),
    ]),
  ).toBe("inspect the parser")
})

it.live("notifies the parent when a human steers a subagent", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Steering main" })
      const child = yield* sessions.create({ parentID: chat.id, title: "Worker" })

      yield* llm.push(reply().text("ack").stop())
      yield* prompt.prompt({
        sessionID: child.id,
        agent: "code",
        parts: [steer("steer the worker to inspect the parser")],
      })

      const board = yield* BoardStore.read({ sessionID: chat.id })
      expect(board.messages).toEqual([
        expect.objectContaining({
          from: child.id,
          to: "main",
          type: "INFO",
          body: expect.stringContaining("steer the worker to inspect the parser"),
        }),
      ])
    }),
    { git: true, config },
  ),
)

it.live("posts escape-heavy steering that exceeds the raw excerpt size", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Escaped steering" })
      const child = yield* sessions.create({ parentID: chat.id, title: "Worker" })

      yield* llm.push(reply().text("ack").stop())
      yield* prompt.prompt({ sessionID: child.id, agent: "code", parts: [steer('"\\'.repeat(2000))] })

      expect((yield* BoardStore.read({ sessionID: chat.id })).messages).toHaveLength(1)
    }),
    { git: true, config },
  ),
)

it.live("does not notify for unmarked child prompts or noReply steering", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Unmarked" })
      const child = yield* sessions.create({ parentID: chat.id, title: "Worker" })

      yield* llm.push(reply().text("ack").stop())
      yield* prompt.prompt({
        sessionID: child.id,
        agent: "code",
        parts: [{ type: "text", text: "task-tool style prompt without a steering mark" }],
      })
      yield* prompt.prompt({ sessionID: child.id, agent: "code", noReply: true, parts: [steer("note only")] })

      expect((yield* BoardStore.read({ sessionID: chat.id })).messages).toEqual([])
    }),
    { git: true, config },
  ),
)

it.live("does not notify the parent when the task tool launches a subagent", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Task launch",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })

      yield* llm.push(
        reply().tool("task", {
          description: "inspect parser",
          prompt: "worker assignment: inspect the parser edge",
          subagent_type: "general",
        }),
      )
      yield* llm.push(reply().text("worker result").stop())
      yield* llm.push(reply().text("main done").stop())
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "code",
        parts: [{ type: "text", text: "delegate the parser inspection" }],
      })

      const children = yield* sessions.children(chat.id)
      expect(children).toHaveLength(1)
      const child = children.at(0)
      if (!child) throw new Error("task tool did not create a child session")
      const users = (yield* sessions.messages({ sessionID: child.id })).filter((item) => item.info.role === "user")
      expect(JSON.stringify(users)).toContain("worker assignment: inspect the parser edge")
      expect((yield* BoardStore.read({ sessionID: chat.id })).messages).toEqual([])
    }),
    { git: true, config },
  ),
)

it.live("does not notify the parent when the main session is prompted", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Main only" })

      yield* llm.push(reply().text("ack").stop())
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "code",
        parts: [steer("work on the main task")],
      })

      const board = yield* BoardStore.read({ sessionID: chat.id })
      expect(board.messages).toEqual([])
    }),
    { git: true, config },
  ),
)
