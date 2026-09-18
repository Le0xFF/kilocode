// kilocode_change - offline speech-to-text catalog: the local media surface exposes no hosted /kilo/models/transcriptions
// endpoint, so discovery goes to the custom source (user-declared OpenAI-compatible endpoint) or degrades to the empty
// catalog (speech input stays available for users that wire a local recognizer).
import type { SpeechToTextModelDef } from "./models"
import { hasCustomSource, sourceHeaders, sourceUrl, type SpeechToTextSource } from "./source"

type CatalogModel = {
  id: string
  name: string
}

export type SpeechToTextModelsResult = { ok: true; models: SpeechToTextModelDef[] } | { ok: false; error: string }

/**
 * Offline stub: there is no hosted transcription model catalog on the local media
 * surface. If the user configured a custom OpenAI-compatible source we probe its
 * `models` route; otherwise the catalog stays empty and the explicit
 * `speech_to_text_model` setting (if any) is what actually gets used at runtime.
 */
export async function fetchSpeechToTextModels(
  source?: SpeechToTextSource,
  signal?: AbortSignal,
): Promise<SpeechToTextModelsResult> {
  if (!hasCustomSource(source)) return { ok: true, models: [] }
  const custom = source as Exclude<typeof source, undefined>
  try {
    const res = await fetch(sourceUrl(custom, "models"), { signal, headers: sourceHeaders(custom) })
    if (!res.ok)
      return {
        ok: false,
        error: `Failed to fetch speech-to-text models from ${custom.baseUrl} (HTTP ${res.status})`,
      }
    const models = parseCustomCatalog(await res.json(), custom.baseUrl)
    if (!models) return { ok: false, error: `Invalid speech-to-text model catalog from ${custom.baseUrl}` }
    return { ok: true, models }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export function parseCustomCatalog(body: unknown, origin: string): SpeechToTextModelDef[] | undefined {
  const list = Array.isArray(body) ? body : data(body)
  if (!list) return undefined

  const provider = label(origin)
  const models = list.filter(hasId).map((model) => ({
    id: model.id,
    label: typeof model.name === "string" && model.name ? model.name : model.id,
    provider,
  }))
  return models.length > 0 ? models : undefined
}

function data(body: unknown): unknown[] | undefined {
  const list = (body as { data?: unknown } | null)?.data
  return Array.isArray(list) ? list : undefined
}

function label(origin: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(origin)
  return match?.[1] ?? origin ?? "Custom"
}

function hasId(value: unknown): value is { id: string; name?: unknown } {
  return !!value && typeof value === "object" && typeof (value as Record<string, unknown>).id === "string"
}