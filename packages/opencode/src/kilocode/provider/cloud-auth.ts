// kilocode_change - bedrock/vertex auth helpers removed with the online cloud surface; only providerKey remains
import type { Auth } from "@/auth"

export function providerKey(providerID: string, auth: Auth.Info) {
  if (auth.type !== "api") return
  // kilocode_change start - amazon-bedrock/google-vertex access remain in the stored-auth surface and keep
  // structured credentials out of the generic provider key; their native loader branches were removed in Step 2
  if (providerID === "amazon-bedrock" && auth.metadata?.authType === "accessKey") return
  if (providerID === "google-vertex" && auth.metadata?.authType === "serviceAccount") return
  // kilocode_change end
  return auth.key
}

// kilocode_change start - upstream openai-compatible tool-content normalization (opt-in via provider option
// "kiloOpenAICompatibleToolCallContent" = "empty-string"): upstream wires it through vertexOptions, whose
// cloud channel was removed here, so vertexOptions degenerates to the provider-agnostic patch below and
// Provider.resolveSDK calls it unchanged from upstream
const TOOL_CONTENT = "kiloOpenAICompatibleToolCallContent"

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

type RequestBody = Record<string, unknown>
type RequestTransform = (body: RequestBody) => RequestBody

function isRequestTransform(value: unknown): value is RequestTransform {
  return typeof value === "function"
}

export function vertexOptions(providerID: string, npm: string, options: Record<string, unknown>) {
  // kilocode_change - vertex credential channel removed with the online cloud surface; only the
  // openai-compatible tool-content patch remains, provider-agnostic
  patchToolContent(npm, options)
}

function patchToolContent(npm: string, options: Record<string, unknown>) {
  const mode = options[TOOL_CONTENT]
  delete options[TOOL_CONTENT]
  if (!npm.includes("@ai-sdk/openai-compatible") || mode !== "empty-string") return

  const prev = isRequestTransform(options.transformRequestBody) ? options.transformRequestBody : undefined
  options.transformRequestBody = (body: RequestBody) => {
    const next = prev?.(body) ?? body
    if (!Array.isArray(next.messages)) return next
    return {
      ...next,
      messages: next.messages.map((msg) => {
        if (!record(msg)) return msg
        if (msg.role !== "assistant" || msg.content !== null) return msg
        if (!Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) return msg
        return { ...msg, content: "" }
      }),
    }
  }
}
// kilocode_change end
