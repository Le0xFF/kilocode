import { parse as parseYaml } from "yaml"
import type {
  AgentMarketplaceItem,
  McpMarketplaceItem,
  MarketplaceItem,
  PluginMarketplaceItem,
  SkillMarketplaceItem,
} from "./schema"

// Offline fork (2026-10-24): the marketplace catalog is hosted at api.kilo.ai,
// which this fork must never reach. The catalog endpoints stay registered for
// shape stability, but the four catalog fetches now return empty item lists
// without any network access, so `GET /kilocode/marketplace` always reports an
// empty catalog. The upstream HTTP/timeout/retry/cache machinery and the remote
// `RawSkill` transform were removed together with the probes; the pure helpers
// `kebabToTitleCase` and `parseResponse` are kept (they are offline and still
// exercised by the tests). See docs/upstream-sync.md (residual-online matrix)
// and PRUNE-NOTES.md.

type Fetch = typeof fetch

export type FetchOptions = {
  fetch?: Fetch
  baseUrl?: string
}

export function kebabToTitleCase(str: string): string {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function parseResponse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return parseYaml(text)
  }
}

export async function fetchAgents(_opts: FetchOptions = {}): Promise<AgentMarketplaceItem[]> {
  void _opts
  return []
}

export async function fetchMcps(_opts: FetchOptions = {}): Promise<McpMarketplaceItem[]> {
  void _opts
  return []
}

export async function fetchSkills(_opts: FetchOptions = {}): Promise<SkillMarketplaceItem[]> {
  void _opts
  return []
}

export async function fetchPlugins(_opts: FetchOptions = {}): Promise<PluginMarketplaceItem[]> {
  void _opts
  return []
}

export async function fetchAll(_opts: FetchOptions = {}): Promise<{ items: MarketplaceItem[]; errors: string[] }> {
  const [agents, mcps, skills, plugins] = await Promise.all([
    fetchAgents(_opts),
    fetchMcps(_opts),
    fetchSkills(_opts),
    fetchPlugins(_opts),
  ])
  return { items: [...agents, ...mcps, ...skills, ...plugins], errors: [] }
}
