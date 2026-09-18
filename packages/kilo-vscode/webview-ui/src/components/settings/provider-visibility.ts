import type { Provider, ProviderConfig } from "../../types/messages"
import type { ProviderAuthMethod } from "@kilocode/sdk/v2/client"
import { isCustomProviderPackage } from "../../../../src/shared/provider-model"
import { isLocalProviderOptionalApiKey } from "../../utils/local-providers"

export function canChangeProviderKey(
  item: Provider,
  cfg: ProviderConfig | undefined,
  methods: ProviderAuthMethod[] | undefined,
) {
  if (item.source !== "api" && item.source !== "config") return false
  // Config keys override the stored key written by the connection dialog.
  if (cfg?.options?.apiKey != null || cfg?.api_key != null) return false
  if (isCustomProviderPackage(cfg?.npm)) return false
  if (isLocalProviderOptionalApiKey(item.id)) return false
  // Only offer key replacement when the dialog opens a standard API-key form.
  return (
    methods === undefined || (methods.length === 1 && methods.at(0)?.type === "api" && !methods.at(0)?.prompts?.length)
  )
}

export function disabledProviderOptions(
  providers: Record<string, Provider>,
  disabled: string[],
  surface?: ReadonlySet<string>,
) {
  const current = new Set(disabled)
  return Object.values(providers)
    .filter((item) => !current.has(item.id))
    .filter((item) => (surface ? surface.has(item.id) : true))
    .map((item) => ({ value: item.id, label: item.name }))
    .sort((a, b) => a.label.localeCompare(b.label))
}