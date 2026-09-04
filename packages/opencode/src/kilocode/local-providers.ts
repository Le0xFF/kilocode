export const LOCAL_PROVIDER_IDS = new Set(["lmstudio", "atomic-chat", "privatemode-ai"])

export function inLocalSurface(id: string, configuredIds: ReadonlySet<string>): boolean {
  return LOCAL_PROVIDER_IDS.has(id) || configuredIds.has(id)
}