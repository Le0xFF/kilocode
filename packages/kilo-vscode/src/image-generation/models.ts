import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import { getErrorMessage } from "../kilo-provider-utils"

export type ImageModel = {
  id: string
  name: string
  description?: string
}

export type ImageModelsResult = { ok: true; models: ImageModel[] } | { ok: false; error: string }

export async function fetchImageModels(
  connection: KiloConnectionService,
  dir: string,
): Promise<ImageModelsResult> {
  const client = connection.getClient()
  try {
    const { data, error } = await client.mediaLocal.img.models(
      { directory: dir || undefined },
      { throwOnError: false },
    )
    if (error) return { ok: false, error: getErrorMessage(error) || "Failed to fetch image models" }
    const models = Array.isArray(data) ? (data as unknown[]).filter(isImageModel).map(toImageModel) : []
    return { ok: true, models }
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) }
  }
}

function isImageModel(value: unknown): value is ImageModel {
  if (!value || typeof value !== "object") return false
  const model = value as Record<string, unknown>
  return typeof model.id === "string" && typeof model.name === "string"
}

function toImageModel(model: ImageModel): ImageModel {
  return {
    id: model.id,
    name: model.name,
    ...(model.description ? { description: model.description } : {}),
  }
}