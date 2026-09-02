import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import { getErrorMessage } from "../kilo-provider-utils"
import { type SpeechToTextModelDef } from "./models"

type CatalogModel = {
  id: string
  name: string
}

export type SpeechToTextCatalogResult = { ok: true; models: SpeechToTextModelDef[] } | { ok: false; error: string }

export async function fetchSpeechToTextModels(
  connection: KiloConnectionService,
  dir: string,
): Promise<SpeechToTextCatalogResult> {
  const client = connection.getClient()
  try {
    const { data, error } = await client.mediaLocal.stt.models(
      { directory: dir || undefined },
      { throwOnError: false },
    )
    if (error) return fail(getErrorMessage(error) || "Failed to fetch speech-to-text models")
    const models = parseSpeechToTextCatalog(data)
    if (!models) return fail("No speech-to-text models configured")
    return { ok: true, models }
  } catch (err) {
    return fail(getErrorMessage(err))
  }
}

function fail(error: string): SpeechToTextCatalogResult {
  return { ok: false, error }
}

export function parseSpeechToTextCatalog(body: unknown): SpeechToTextModelDef[] | undefined {
  if (!Array.isArray(body)) return undefined
  const models = body.filter(isCatalogModel).map(toModel)
  return models.length > 0 ? models : undefined
}

function isCatalogModel(value: unknown): value is CatalogModel {
  if (!value || typeof value !== "object") return false
  const model = value as Record<string, unknown>
  return typeof model.id === "string" && typeof model.name === "string"
}

function toModel(model: CatalogModel): SpeechToTextModelDef {
  const index = model.id.indexOf("/")
  const provider = index === -1 ? "" : model.id.slice(0, index)
  const label = index === -1 ? model.id : model.id.slice(index + 1)
  return {
    id: model.id,
    label: label || model.name,
    provider,
  }
}