import type { ProviderMetadata } from "@opencode-ai/llm"

export namespace KiloRoutedModel {
  const ns = "kilocode"
  const key = "routedModelID"

  export function write(meta: ProviderMetadata | undefined, modelID: string | undefined) {
    const id = modelID?.trim()
    if (!id) return meta
    return {
      ...(meta ?? {}),
      [ns]: {
        ...(meta?.[ns] ?? {}),
        [key]: id,
      },
    } satisfies ProviderMetadata
  }

  export function display(modelID: string) {
    return modelID.trim().replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, "")
  }

  export function displayName(name: string) {
    return name
      .trim()
      .replace(/^[^:]+:\s+/, "")
      .replace(/^[^/\s]+\/(?=[^/]+$)/, "")
      .replace(/\s*\([^)]*%\s*off[^)]*\)\s*$/i, "")
      .replace(/^([A-Za-z]{2,})(?=\d)/, "$1 ")
      .replace(/\s+/g, " ")
  }
}