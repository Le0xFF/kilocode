import { iconNames, type IconName } from "@opencode-ai/ui/icons/provider"

export type ProviderMetadata = {
  noteKey?: string
  icon?: string
  priority?: number
}

// kilocode_change start - notes/order tables resized to the local surface after the online providers were removed;
// unknown ids keep the defensive lookup (synthetic icon, no note/priority).
const notes: Record<string, string> = {
  opencode: "settings.providers.note.opencode",
  anthropic: "settings.providers.note.anthropic",
  deepseek: "settings.providers.note.deepseek",
  openai: "settings.providers.note.openai",
  "anaconda-desktop": "settings.providers.note.anacondaDesktop",
}

const order = ["anthropic", "deepseek", "openai", "anaconda-desktop"] as const

const priority = new Map<string, number>(order.map((id, index) => [id, index]))

const icons = new Set<string>(iconNames)

function key(id: string) {
  if (id.startsWith("github-copilot")) return "github-copilot"
  return id
}
// kilocode_change end

export function providerMetadata(id: string): ProviderMetadata {
  const name = key(id)
  const note = notes[name]
  return {
    noteKey: note,
    icon: icons.has(name as IconName) ? name : "synthetic",
    priority: priority.get(name),
  }
}