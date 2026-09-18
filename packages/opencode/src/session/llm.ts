import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { llmClient } from "@opencode-ai/core/effect/app-node-platform"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Provider } from "@/provider/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Log } from "@opencode-ai/core/util/log" // kilocode_change
import { Context, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { streamText, wrapLanguageModel, type ModelMessage, type Tool } from "ai"
import type { LLMEvent } from "@opencode-ai/llm"
import { LLMClient } from "@opencode-ai/llm/route"
import type { LLMClientService } from "@opencode-ai/llm/route"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import type { Agent } from "@/agent/agent"
import { usable } from "./overflow" // kilocode_change
import { Plugin } from "@/plugin"
import { Permission } from "@/permission"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Auth } from "@/auth"
// kilocode_change start
import { KiloLLM } from "@/kilocode/session/llm"
import { KiloSessionOverflow } from "@/kilocode/session/overflow"
import { KiloToolSchema } from "@/kilocode/session/tool-schema"
// kilocode_change end
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LLMAISDK } from "./llm/ai-sdk"
import { LLMNativeRuntime } from "./llm/native-runtime"
import { LLMRequestPrep } from "./llm/request"

const log = Log.create({ service: "llm" }) // kilocode_change

export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

export type StreamInput = {
  user: SessionV1.User
  sessionID: string
  parentSessionID?: string
  model: Provider.Model
  agent: Agent.Info
  permission?: PermissionV1.Ruleset
  system: string[]
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
  preflight?: boolean // kilocode_change - enable proactive threshold compaction for normal session turns
  reportedContextTokens?: number // kilocode_change - provider-reported context size from the last finished turn, source of truth for the output cap
}

export type StreamRequest = StreamInput & {
  abort: AbortSignal
}

export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<LLMEvent, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM") {}

export const use = serviceUse(Service)

const live: Layer.Layer<
  Service,
  never,
  | Auth.Service
  | Config.Service
  | Provider.Service
  | Plugin.Service
  | Permission.Service
  | EventV2Bridge.Service
  | LLMClientService
  | RuntimeFlags.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const plugin = yield* Plugin.Service
    const perm = yield* Permission.Service
    const events = yield* EventV2Bridge.Service
    const llmClient = yield* LLMClient.Service
    const flags = yield* RuntimeFlags.Service

    const run = Effect.fn("LLM.run")(function* (input: StreamRequest) {
      const l = log.clone().tag("providerID", input.model.providerID).tag("modelID", input.model.id) // kilocode_change
      yield* Effect.logInfo("stream", {
        providerID: input.model.providerID,
        modelID: input.model.id,
        "session.id": input.sessionID,
        small: (input.small ?? false).toString(),
        agent: input.agent.name,
        mode: input.agent.mode,
      })

      const [language, cfg, item, info] = yield* Effect.all(
        [
          provider.getLanguage(input.model),
          config.get(),
          provider.getProvider(input.model.providerID),
          auth.get(input.model.providerID),
        ],
        { concurrency: "unbounded" },
      )
      // kilocode_change - gitlab workflow support removed with the online plugins; always false
      const isWorkflow = false
      const base = yield* LLMRequestPrep.prepare({
        ...input,
        provider: item,
        auth: info,
        plugin,
        flags,
        isWorkflow,
      })

      // kilocode_change start - compact at the configured threshold before contacting the provider
      const tools = yield* Effect.promise(() => KiloToolSchema.sanitize(base.tools))
      const isOpenaiOauth = item.id === "openai" && info?.type === "oauth"
      const estimated: ModelMessage[] =
        isOpenaiOauth || isWorkflow
          ? [
              {
                role: "system",
                content: isOpenaiOauth ? String(base.params.options.instructions ?? "") : base.system.join("\n"),
              },
              ...base.messages,
            ]
          : base.messages
      const preflight = input.preflight === true && KiloSessionOverflow.enabled({ cfg, model: input.model })
      const cap = KiloLLM.needsEstimate({ model: input.model, configured: base.params.maxOutputTokens })
      const usage = cap || preflight ? KiloSessionOverflow.measure({ messages: estimated, tools }) : undefined
      const maxOutputTokens = KiloLLM.capOutputTokens({
        model: input.model,
        messages: estimated,
        tools,
        configured: base.params.maxOutputTokens,
        usage,
        reported: input.reportedContextTokens,
      })
      if (
        preflight &&
        usage &&
        KiloSessionOverflow.shouldCompact({
          cfg,
          model: input.model,
          usable: usable({ cfg, model: input.model, outputTokenMax: flags.outputTokenMax }), // kilocode_change
          tokens: usage.normalized,
          continuation: usage.continuation,
        })
      ) {
        return yield* Effect.fail(new KiloSessionOverflow.PreflightError())
      }
      const prepared = { ...base, tools, params: { ...base.params, maxOutputTokens } }
      // kilocode_change end

      // Wire up toolExecutor for DWS workflow models so that tool calls
      // from the workflow service are executed via opencode's tool system
      // and results sent back over the WebSocket.
      const bridge = yield* EffectBridge.make()
      // kilocode_change - gitlab workflow support removed with the online plugins; block is dead code, kept for fork sync
      if (false) {
        const workflowModel = language as any
        void workflowModel.sessionID
        void workflowModel.systemPrompt
        void workflowModel.toolExecutor
        void workflowModel.sessionPreapprovedTools
        void workflowModel.approvalHandler
      }

      // Runtime seam: native is an opt-in adapter over @opencode-ai/llm. It
      // either returns a ready LLMEvent stream or a concrete fallback reason.
      if (flags.experimentalNativeLlm) {
        const native = LLMNativeRuntime.stream({
          model: input.model,
          provider: item,
          auth: info,
          llmClient,
          messages: prepared.messages,
          tools: prepared.tools,
          toolChoice: input.toolChoice,
          temperature: prepared.params.temperature,
          topP: prepared.params.topP,
          topK: prepared.params.topK,
          // kilocode_change start
          maxOutputTokens: ProviderTransform.maxOutputTokensForRequest({
            model: input.model,
            options: prepared.params.options,
            maxOutputTokens: prepared.params.maxOutputTokens,
          }),
          // kilocode_change end
          providerOptions: prepared.params.options,
          headers: prepared.headers,
          abort: input.abort,
        })
        if (native.type === "supported") {
          yield* Effect.logInfo("llm runtime selected", {
            "llm.runtime": "native",
            "llm.provider": input.model.providerID,
            "llm.model": input.model.id,
          })
          return {
            type: "native" as const,
            stream: native.stream,
          }
        }
yield* Effect.logInfo("native runtime unavailable; falling back to ai-sdk", {
          providerID: input.model.providerID,
          modelID: input.model.id,
          "session.id": input.sessionID,
          small: (input.small ?? false).toString(),
          agent: input.agent.name,
          mode: input.agent.mode,
          reason: native.reason,
        })
      }

      yield* Effect.logInfo("llm runtime selected", {
        "llm.runtime": "ai-sdk",
        "llm.provider": input.model.providerID,
        "llm.model": input.model.id,
      })
      // Default runtime path: AI SDK owns provider execution and tool dispatch;
      // LLMAISDK.toLLMEvents below normalizes fullStream parts for the processor.
      const result = streamText({
        onError(error) {
          bridge.fork(
            Effect.logError("stream error", {
              providerID: input.model.providerID,
              modelID: input.model.id,
              "session.id": input.sessionID,
              small: (input.small ?? false).toString(),
              agent: input.agent.name,
              mode: input.agent.mode,
              error,
            }),
          )
        },
        // Copilot returns the authoritative billed amount only in provider-specific response fields.
        includeRawChunks: input.model.providerID.includes("github-copilot"),
        async experimental_repairToolCall(failed) {
          const lower = failed.toolCall.toolName.trim().toLowerCase() // kilocode_change
          if (lower !== failed.toolCall.toolName && prepared.tools[lower]) {
            l.info("repairing tool call", { tool: failed.toolCall.toolName, repaired: lower }) // kilocode_change
            return { ...failed.toolCall, toolName: lower }
          }
          // kilocode_change start - surface the original tool-name error instead of a
          // repaired call to the hidden "invalid" tool, which activeTools excludes and
          // therefore fails with a confusing "unavailable tool 'invalid'" error
          return null
          // kilocode_change end
        },
        temperature: prepared.params.temperature,
        topP: prepared.params.topP,
        topK: prepared.params.topK,
        providerOptions: ProviderTransform.providerOptions(input.model, prepared.params.options),
        activeTools: Object.keys(prepared.tools).filter((x) => x !== "invalid"),
        // kilocode_change start
        tools: prepared.tools,
        toolChoice: input.toolChoice,
        maxOutputTokens: ProviderTransform.maxOutputTokensForRequest({
          model: input.model,
          options: prepared.params.options,
          maxOutputTokens: prepared.params.maxOutputTokens,
        }),
        // kilocode_change end
        abortSignal: input.abort,
        ...KiloLLM.timeout({ options: prepared.params.options, fallback: item.options, log: l }), // kilocode_change
        headers: prepared.headers,
        maxRetries: input.retries ?? 0,
        allowSystemInMessages: true, // kilocode_change - system prompts are trusted and intentionally included in messages
        messages: prepared.messages,
        model: wrapLanguageModel({
          model: language,
          middleware: [
            {
              specificationVersion: "v3" as const,
              async transformParams(args) {
                if (args.type === "stream") {
                  // @ts-expect-error
                  args.params.prompt = ProviderTransform.message(
                    args.params.prompt,
                    input.model,
                    prepared.messageTransformOptions,
                  )
                }
                return args.params
              },
            },
          ],
        }),
      })
      
    return { type: "ai-sdk" as const, result }
    })

    const stream: Interface["stream"] = (input) =>
      Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            const ctrl = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (ctrl) => Effect.sync(() => ctrl.abort()),
            )

            const result = yield* run({ ...input, abort: ctrl.signal })

            if (result.type === "native") return result.stream

            // Adapter seam: both runtimes expose the same LLMEvent stream. Native
            // already returns one; AI SDK streams are converted here.
            const state = LLMAISDK.adapterState()
            return Stream.fromAsyncIterable(result.result.fullStream, (e) =>
              e instanceof Error ? e : new Error(String(e)),
            ).pipe(
              Stream.mapEffect((event) => LLMAISDK.toLLMEvents(state, event)),
              Stream.flatMap((events) => Stream.fromIterable(events)),
            )
          }),
        ),
      )

    return Service.of({ stream })
  }),
)

export const hasToolCalls = LLMRequestPrep.hasToolCalls

export const node = LayerNode.make({
  service: Service,
  layer: live,
  deps: [
    Auth.node,
    Config.node,
    Provider.node,
    Plugin.node,
    Permission.node,
    EventV2Bridge.node,
    llmClient,
    RuntimeFlags.node,
  ],
})

export * as LLM from "./llm"
