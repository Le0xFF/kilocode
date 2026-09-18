import { Effect } from "effect"
import type { Config } from "@/config/config"

type ProviderInfo = NonNullable<NonNullable<Config.Info["provider"]>[string]> & object
type Options = Record<string, unknown>
type Model = { id: string; name: string }

export function splitModel(model: string): { providerID: string; modelID: string } | undefined {
  const index = model.indexOf("/")
  if (index === -1) return undefined
  return { providerID: model.slice(0, index), modelID: model.slice(index + 1) }
}

export function baseOf(baseURL: string): string {
  let url = baseURL.trim()
  for (const suffix of ["/v1", "/api/v1"]) {
    if (url.endsWith(suffix)) {
      url = url.slice(0, -suffix.length)
      break
    }
  }
  return url.replace(/\/+$/, "")
}

function pick(options: Options, key: string): string | undefined {
  const value = options?.[key]
  return typeof value === "string" && value ? value : undefined
}

export function resolveEndpoint(cfg: Config.Info, model: string, path: string): { url: string; apiKey?: string } {
  const ref = splitModel(model)
  if (!ref) throw new Error(`Invalid model reference "${model}" (expected providerID/modelID)`)
  const entry = cfg.provider?.[ref.providerID]
  if (!entry || entry === null) throw new Error(`Provider "${ref.providerID}" not found in config`)
  const info: ProviderInfo = entry
  const opts = (info.options ?? {}) as Options
  const key = pick(opts, "apiKey")
  const base = info.api ?? pick(opts, "baseURL")
  if (!base) throw new Error(`Provider "${ref.providerID}" has no baseURL configured`)
  return { url: `${baseOf(base)}/${path}`, apiKey: key }
}

function authHeader(key?: string): Record<string, string> {
  return key ? { Authorization: `Bearer ${key}` } : {}
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export class UpstreamError extends Error {}

export namespace MediaLocal {
  export const imgModels = Effect.fn("MediaLocal.imgModels")(function* (cfg: Config.Info) {
    const models: Model[] = []
    const image = cfg.experimental?.image_generation_provider
    const ref = image?.provider && image.model ? `${image.provider}/${image.model}` : undefined
    if (ref) models.push({ id: ref, name: ref })
    const legacy = cfg.experimental?.image_generation_model
    if (legacy && !models.some((item) => item.id === legacy)) models.push({ id: legacy, name: legacy })
    return models
  })

  export const generate = Effect.fn("MediaLocal.generate")(function* (input: {
    cfg: Config.Info
    model: string
    prompt: string
    size?: string
    n?: number
  }) {
    const end = resolveEndpoint(input.cfg, input.model, "images/generations")
    const payload: Record<string, unknown> = { model: input.model.split("/").at(-1) ?? input.model, prompt: input.prompt }
    if (input.size) payload.size = input.size
    if (input.n) payload.n = input.n
    const res = yield* Effect.promise(() =>
      fetch(end.url, {
        method: "POST",
        headers: { ...authHeader(end.apiKey), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    )
    const body = yield* Effect.promise(() => res.text())
    if (!res.ok) throw new UpstreamError(`Upstream error (${res.status}): ${body.slice(0, 500)}`)
    return parseJson(body)
  })
}