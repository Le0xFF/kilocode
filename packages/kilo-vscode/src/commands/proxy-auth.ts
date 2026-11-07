/**
 * Command Palette commands for proxy authentication: set / clear / status.
 *
 * The commands only manage the {@link ProxyAuthState} (session-only or
 * keychain-stored credentials) and report plain-English results. Pushing the
 * credential to the CLI backend is the connection service's job — the set and
 * clear handlers trigger it via `service.pushProxyAuth()`. The Settings
 * "Network" tab (webview) reuses the shared helpers below — {@link
 * promptProxyCredentials}, {@link applyProxyAuth}, {@link displayProxy}, and
 * {@link runClearProxyAuth} — so both surfaces behave identically. User-facing
 * strings are plain English (internationalization lands in a later step).
 */
import * as vscode from "vscode"
import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import type { ProxyAuthState } from "../services/cli-backend/proxy-auth-state"
import { proxyHost } from "../services/cli-backend/proxy-auth-state"
import { hasEmbeddedCredentials, proxyAuthKey } from "../services/cli-backend/proxy-auth"

/**
 * Read the effective `http.proxy` value the way the CLI backend activates
 * proxy support (`buildProxyEnv`): `http.proxySupport: "off"` disables proxy
 * support entirely, and an absent or blank `http.proxy` means none.
 */
export function readEffectiveProxy(): string | null {
  const http = vscode.workspace.getConfiguration("http")
  if (http.get<string>("proxySupport") === "off") return null
  const proxy = http.get<string>("proxy")
  if (proxy === undefined || proxy.trim() === "") return null
  return proxy
}

const STORE_CHOICES = ["Use only for this session (not stored)", "Remember — store securely in the OS keychain"] as const

/**
 * Prompt for the proxy username and password host-side, where they belong —
 * the password never crosses the webview boundary. Returns null when the user
 * cancels or the password is empty.
 */
export async function promptProxyCredentials(): Promise<{ user: string; password: string } | null> {
  const user = await vscode.window.showInputBox({
    prompt: "Proxy username",
    placeHolder: "Enter a username (empty for anonymous)",
  })
  if (user === undefined) return null
  const password = await vscode.window.showInputBox({
    prompt: "Proxy password",
    placeHolder: "Enter a password",
    password: true,
  })
  // An empty password (or cancelling the prompt) aborts the set.
  if (password === undefined || password === "") return null
  return { user, password }
}

/** Apply the credential to the state and push the change to the backend. */
export async function applyProxyAuth(
  state: ProxyAuthState,
  service: KiloConnectionService,
  input: { user: string; password: string; remember: boolean },
): Promise<void> {
  await state.set(input)
  await service.pushProxyAuth()
}

/**
 * A display-safe view of the effective proxy for the webview: the value as
 * configured, with inline credentials stripped. The raw value must never reach
 * the webview with credentials attached, so when the URL embeds a `user`
 * component only the normalized scheme/host/port is returned (the same
 * normalization the credential key uses; null when it cannot be normalized).
 */
export function displayProxy(proxy: string | null): { target: string | null; inline: boolean } {
  if (proxy === null) return { target: null, inline: false }
  if (!hasEmbeddedCredentials(proxy)) return { target: proxy, inline: false }
  const key = proxyAuthKey(proxy)
  return { target: key === null ? null : key.slice("kilo.proxyAuth.".length), inline: true }
}

/** Prompt for credentials, update state, push to the backend, and confirm. */
export async function runSetProxyAuth(state: ProxyAuthState, service: KiloConnectionService): Promise<void> {
  const proxy = readEffectiveProxy()
  if (proxy === null) {
    vscode.window.showInformationMessage("Set the `http.proxy` setting first")
    return
  }
  if (hasEmbeddedCredentials(proxy)) {
    vscode.window.showInformationMessage("Inline credentials in `http.proxy` are in use; stored credentials are ignored")
    return
  }
  const cred = await promptProxyCredentials()
  if (cred === null) return
  const choice = await vscode.window.showQuickPick([...STORE_CHOICES])
  if (choice === undefined) return
  await applyProxyAuth(state, service, { user: cred.user, password: cred.password, remember: choice === STORE_CHOICES[1] })
  const host = proxyHost(proxy) ?? "proxy"
  vscode.window.showInformationMessage(`Proxy credentials set for ${host} (user: ${cred.user || "anonymous"})`)
}

/** Clear stored and session credentials, push the change, and confirm. */
export async function runClearProxyAuth(state: ProxyAuthState, service: KiloConnectionService): Promise<void> {
  const status = await state.status()
  await state.clear()
  await service.pushProxyAuth()
  const host = status.host
  vscode.window.showInformationMessage(host ? `Proxy credentials cleared (host: ${host})` : "Proxy credentials cleared")
}

/** Show a credential-free summary of the proxy auth configuration. */
export async function runProxyAuthStatus(state: ProxyAuthState): Promise<void> {
  const status = await state.status()
  if (status.proxy === null) {
    vscode.window.showInformationMessage("No proxy is configured (`http.proxy`)")
    return
  }
  const host = status.host ?? "unknown"
  const user = status.username ?? "anonymous"
  const mechanism = status.mechanism ? status.mechanism[0].toUpperCase() + status.mechanism.slice(1) : "none"
  const stored = status.stored ? "yes" : "no"
  vscode.window.showInformationMessage(
    `Proxy: ${status.proxy} | host: ${host} | user: ${user} | mechanism: ${mechanism} | stored in keychain: ${stored}`,
  )
}

export function registerProxyAuthCommands(
  context: vscode.ExtensionContext,
  service: KiloConnectionService,
  state: ProxyAuthState,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.proxyAuth.set", () => void runSetProxyAuth(state, service)),
    vscode.commands.registerCommand("kilo-code.new.proxyAuth.clear", () => void runClearProxyAuth(state, service)),
    vscode.commands.registerCommand("kilo-code.new.proxyAuth.status", () => void runProxyAuthStatus(state)),
  )
}
