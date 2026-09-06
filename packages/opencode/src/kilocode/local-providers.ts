// "anaconda-desktop" is a local OpenAI-compatible provider discovered on this machine (points at
// 127.0.0.1); whitelisting it makes its surface entry coherent with inLocalSurface even though the
// catalog entry itself is still injected by the AnacondaDesktopPlugin overlay (belt-and-braces).
export const LOCAL_PROVIDER_IDS = new Set(["lmstudio", "atomic-chat", "privatemode-ai", "anaconda-desktop"])

export function inLocalSurface(id: string, configuredIds: ReadonlySet<string>): boolean {
  return LOCAL_PROVIDER_IDS.has(id) || configuredIds.has(id)
}