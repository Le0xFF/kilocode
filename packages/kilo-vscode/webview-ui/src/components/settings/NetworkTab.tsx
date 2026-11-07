import { Component, createSignal, onCleanup, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { ProxyAuthStatusLoadedMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"

const NetworkTab: Component = () => {
  const language = useLanguage()
  const vscode = useVSCode()
  const [status, setStatus] = createSignal<ProxyAuthStatusLoadedMessage>()
  const [remember, setRemember] = createSignal(false)

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "proxyAuthStatusLoaded") setStatus(message)
  })
  onCleanup(unsubscribe)
  // The host pushes the status when the webview is ready and again after any
  // set/clear; asking on mount covers a tab that mounts after both.
  vscode.postMessage({ type: "requestProxyAuthStatus" })

  const inline = () => status()?.inlineCredentials === true
  const hasCreds = () => status()?.username != null
  const setDisabled = () => {
    const data = status()
    return data === undefined || data.inlineCredentials || data.proxy === null
  }
  const clearDisabled = () => !hasCreds()
  const credText = () => {
    const data = status()
    if (!data || data.username === null) return language.t("settings.network.credentials.none")
    const mechanism = data.mechanism ? `${data.mechanism[0].toUpperCase()}${data.mechanism.slice(1)}` : ""
    const user = language.t("settings.network.credentials.user", {
      user: data.username || language.t("settings.network.credentials.anonymous"),
    })
    const scope = data.stored
      ? language.t("settings.network.credentials.stored")
      : language.t("settings.network.credentials.session")
    return [data.host, mechanism, user, scope].filter(Boolean).join(" · ")
  }

  return (
    <div style={{ padding: "16px" }}>
      <Card>
        <SettingsRow
          title={language.t("settings.network.proxy.title")}
          description={
            inline()
              ? language.t("settings.network.inlineCredentials.description")
              : status()?.proxy ?? language.t("settings.network.proxy.none")
          }
          tag={inline() ? () => language.t("settings.network.inlineCredentials") : undefined}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <Button
              variant="secondary"
              size="small"
              disabled={setDisabled()}
              onClick={() => vscode.postMessage({ type: "proxyAuth.set", remember: remember() })}
            >
              {language.t("settings.network.set")}
            </Button>
            <Button
              variant="secondary"
              size="small"
              disabled={clearDisabled()}
              onClick={() => vscode.postMessage({ type: "proxyAuth.clear" })}
            >
              {language.t("settings.network.clear")}
            </Button>
          </div>
        </SettingsRow>
        <Show when={!inline()}>
          <SettingsRow
            title={language.t("settings.network.credentials.title")}
            description={language.t("settings.network.credentials.description")}
          >
            <span style={{ "font-size": "var(--kilo-font-size-13)" }}>{credText()}</span>
          </SettingsRow>
        </Show>
        <SettingsRow
          title={language.t("settings.network.remember.title")}
          description={language.t("settings.network.remember.description")}
          last
        >
          <Checkbox checked={remember()} onChange={setRemember} hideLabel>
            {language.t("settings.network.remember.title")}
          </Checkbox>
        </SettingsRow>
      </Card>
      <p
        style={{
          "font-size": "var(--kilo-font-size-12)",
          color: "var(--vscode-descriptionForeground)",
          "margin-top": "12px",
        }}
      >
        {language.t("settings.network.note")}
      </p>
    </div>
  )
}

export default NetworkTab
