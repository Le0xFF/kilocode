type Schema = {
  $ref?: string
  additionalProperties?: Schema | boolean
  anyOf?: Schema[]
  const?: string
  default?: unknown
  enum?: string[]
  items?: Schema
  minimum?: number
  maximum?: number
  properties?: Record<string, Schema>
  type?: string
}

type Parameter = {
  in?: string
  name?: string
  schema?: Schema
}

type Response = {
  content?: Record<string, { schema?: Schema }>
  description?: string
}

type Operation = {
  parameters?: Parameter[]
  requestBody?: {
    content?: Record<string, { schema?: Schema }>
  }
  responses?: Record<string, Response>
}

type Spec = {
  components?: {
    schemas?: Record<string, Schema>
  }
  paths?: Record<string, Partial<Record<"get" | "post" | "put" | "patch", Operation>>>
}

export function matchLegacyKiloOpenApi(input: Record<string, unknown>) {
  rebrand(input)
  const spec = input as Spec

  const rules = spec.paths?.["/config/rules"]?.get?.parameters?.find(
    (param) => param.in === "query" && param.name === "scope",
  )
  if (rules) rules.schema = { const: "project", default: "project", type: "string" }



  const provider = spec.components?.schemas?.Config?.properties?.provider
  if (provider?.additionalProperties && typeof provider.additionalProperties === "object")
    provider.additionalProperties = nullable(provider.additionalProperties)

  const pty = spec.components?.schemas?.Pty?.properties
  if (pty?.sessionID) pty.sessionID = nullable(pty.sessionID)

  const out =
    spec.paths?.["/session/{sessionID}/branch-name"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema
      ?.properties
  if (out?.branch) out.branch = nullable(out.branch)

  const update = spec.paths?.["/pty/{ptyID}"]?.put?.requestBody?.content?.["application/json"]?.schema
  const name = update?.$ref?.replace("#/components/schemas/", "")
  const fields = name ? spec.components?.schemas?.[name]?.properties : update?.properties
  if (fields?.sessionID) fields.sessionID = nullable(fields.sessionID)
}

function rebrand(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) rebrand(item)
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      rebrand(item)
      continue
    }
    ;(value as Record<string, unknown>)[key] = item
      .replaceAll("OpenCode", "Kilo")
      .replaceAll("opencode.local", "kilo.local")
      .replaceAll("opencode serve", "kilo serve")
      .replaceAll("https://opencode.ai/", "https://kilo.ai/")
  }
}

function nullable(schema: Schema): Schema {
  if (schema.anyOf?.some((item) => item.type === "null")) return schema
  return { anyOf: [schema, { type: "null" }] }
}