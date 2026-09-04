import type { Provider } from "../../types/messages"

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