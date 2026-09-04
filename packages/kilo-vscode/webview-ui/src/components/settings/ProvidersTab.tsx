import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { ProviderIcon } from "@kilocode/kilo-ui/provider-icon"
import { Select } from "@kilocode/kilo-ui/select"
import { Tag } from "@kilocode/kilo-ui/tag"
import { showToast } from "@kilocode/kilo-ui/toast"
import { Component, For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useVSCode } from "../../context/vscode"
import type { Provider } from "../../types/messages"
import CustomProviderDialog from "./CustomProviderDialog"
import ProviderConnectDialog from "./ProviderConnectDialog"
import { providerIcon } from "./provider-catalog"
import { disabledProviderOptions } from "./provider-visibility"
import { isCustomProviderPackage } from "../../../../src/shared/provider-model"
import { createProviderAction } from "../../utils/provider-action"

type ProviderSource = "env" | "api" | "config" | "custom"
const LOCAL_SOURCES: ReadonlySet<string> = new Set(["env", "config", "custom"])
// Safety net mirroring the host whitelist (packages/opencode/src/kilocode/local-providers.ts).
// The backend already cuts `connected` to this surface (Step 3); this guards against any
// online built-in leaking into the data. Keep in sync with the host list.
const LOCAL_PROVIDER_IDS: ReadonlySet<string> = new Set(["lmstudio", "atomic-chat", "privatemode-ai"])
type ProviderOption = { value: string; label: string }

const ProvidersTab: Component = () => {
  const dialog = useDialog()
  const { config, updateConfig } = useConfig()
  const provider = useProvider()
  const language = useLanguage()
  const vscode = useVSCode()
  const action = createProviderAction(vscode)
  const [disabled, setDisabled] = createSignal<ProviderOption | undefined>()

  onCleanup(action.dispose)

  const connectedProviders = createMemo(() => {
    const all = provider.providers()
    const configured = new Set(Object.keys(config().provider ?? {}))
    return provider
      .connected()
      .map((id) => all[id])
      .filter((item): item is Provider => !!item)
      .filter((item) => LOCAL_SOURCES.has(source(item) ?? ""))
      .filter((item) => LOCAL_PROVIDER_IDS.has(item.id) || configured.has(item.id))
  })

  const disabledProviders = createMemo(() => config().disabled_providers ?? [])
  const providers = createMemo(() => provider.providers())
  // Safety-net surface for the "Disabled providers" picker: whitelist + configured.
  const localSurface = createMemo(
    () => new Set([...LOCAL_PROVIDER_IDS, ...Object.keys(config().provider ?? {})]),
  )
  const disabledOptions = createMemo(() =>
    disabledProviderOptions(providers(), disabledProviders(), localSurface()),
  )

  function source(item: Provider): ProviderSource | undefined {
    if (!("source" in item)) return
    const value = (item as Provider & { source?: string }).source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  function sourceTag(item: Provider) {
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") {
      const cfg = config().provider?.[item.id]
      if (isCustomProviderPackage(cfg?.npm)) return language.t("settings.providers.tag.custom")
      return language.t("settings.providers.tag.config")
    }
    if (item.id === "openai" && current === "custom") return language.t("settings.providers.tag.chatgpt")
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  function canDisconnect(item: Provider) {
    return source(item) !== "env"
  }

  function isCustom(item: Provider) {
    const cfg = config().provider?.[item.id]
    return isCustomProviderPackage(cfg?.npm)
  }

  function editProvider(item: Provider) {
    const cfg = config().provider?.[item.id]
    if (!cfg) return
    dialog.show(() => <CustomProviderDialog existing={{ providerID: item.id, name: item.name, config: cfg }} />)
  }

  function disconnect(providerID: string, name: string) {
    action.send(
      { type: "disconnectProvider", providerID },
      {
        onDisconnected: () => {
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
            description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
          })
        },
        onError: (message) => {
          showToast({ title: language.t("common.requestFailed"), description: message.message })
        },
      },
    )
  }

  function disableProvider(providerID: string) {
    const current = disabledProviders()
    if (!providerID || current.includes(providerID)) return
    updateConfig({ disabled_providers: [...current, providerID] })
  }

  function enableProvider(index: number) {
    const next = [...disabledProviders()]
    next.splice(index, 1)
    updateConfig({ disabled_providers: next })
  }

  function disabledName(id: string) {
    const item = providers()[id]
    return item?.name ?? id
  }

  function connectChatGPT(item: Provider) {
    dialog.show(() => <ProviderConnectDialog providerID={item.id} oauthOnly />)
  }

  function chatgpt(item: Provider) {
    if (item.id !== "openai") return false
    if (source(item) === "custom") return false
    return (provider.authMethods()[item.id] ?? []).some((method) => method.type === "oauth")
  }

  return (
    <div>
      {/* Connected providers */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>
        {language.t("settings.providers.section.connected")}
      </h4>
      <Card>
        <Show
          when={connectedProviders().length > 0}
          fallback={
            <div
              style={{
                padding: "16px 0",
                "font-size": "var(--kilo-font-size-14)",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              {language.t("settings.providers.connected.empty")}
            </div>
          }
        >
          <For each={connectedProviders()}>
            {(item) => (
              <div
                style={{
                  display: "flex",
                  "flex-wrap": "wrap",
                  "align-items": "center",
                  "justify-content": "space-between",
                  gap: "16px",
                  "min-height": "56px",
                  padding: "12px 0",
                  "border-bottom": "1px solid var(--border-weak-base)",
                }}
              >
                <div style={{ display: "flex", "align-items": "center", gap: "12px", "min-width": 0 }}>
                  <ProviderIcon id={providerIcon(item)} width={20} height={20} />
                  <span
                    style={{
                      "font-size": "var(--kilo-font-size-14)",
                      "font-weight": "500",
                      color: "var(--vscode-foreground)",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}
                  >
                    {item.name}
                  </span>
                  <Tag>{sourceTag(item)}</Tag>
                </div>
                <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                  <Show when={!canDisconnect(item)}>
                    <span
                      style={{
                        "font-size": "var(--kilo-font-size-14)",
                        color: "var(--text-base, var(--vscode-descriptionForeground))",
                        "padding-right": "12px",
                      }}
                    >
                      {language.t("settings.providers.connected.environmentDescription")}
                    </span>
                  </Show>
                  <Show when={chatgpt(item)}>
                    <Button size="large" variant="ghost" onClick={() => connectChatGPT(item)}>
                      {language.t("settings.providers.action.signInChatGPT")}
                    </Button>
                  </Show>
                  <Show when={canDisconnect(item)}>
                    <Show when={isCustom(item)}>
                      <Button size="large" variant="ghost" onClick={() => editProvider(item)}>
                        {language.t("provider.custom.edit.title")}
                      </Button>
                    </Show>
                    <Button size="large" variant="ghost" onClick={() => disconnect(item.id, item.name)}>
                      {language.t(isCustom(item) ? "common.delete" : "common.disconnect")}
                    </Button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </Show>
      </Card>

      {/* Custom providers */}
      <h4 style={{ "margin-top": "24px", "margin-bottom": "8px" }}>
        {language.t("settings.providers.section.custom")}
      </h4>
      <Card>
        <div
          style={{
            display: "flex",
            "flex-wrap": "wrap",
            "align-items": "center",
            "justify-content": "space-between",
            gap: "16px",
            "min-height": "56px",
            padding: "12px 0",
          }}
        >
          <div style={{ display: "flex", "flex-direction": "column", "min-width": 0 }}>
            <div style={{ display: "flex", "flex-wrap": "wrap", "align-items": "center", gap: "12px" }}>
              <ProviderIcon id="synthetic" width={20} height={20} />
              <span
                style={{
                  "font-size": "var(--kilo-font-size-14)",
                  "font-weight": "500",
                  color: "var(--vscode-foreground)",
                }}
              >
                {language.t("provider.custom.title")}
              </span>
              <Tag>{language.t("settings.providers.tag.custom")}</Tag>
            </div>
            <span
              style={{
                "font-size": "var(--kilo-font-size-12)",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                "padding-left": "32px",
              }}
            >
              {language.t("settings.providers.custom.description")}
            </span>
          </div>
          <Button
            size="large"
            variant="secondary"
            icon="plus-small"
            onClick={() => dialog.show(() => <CustomProviderDialog />)}
          >
            {language.t("common.connect")}
          </Button>
        </div>
      </Card>

      {/* Disabled providers — collapsed by default to keep the focus on active providers */}
      <div style={{ "margin-top": "24px" }}>
        <Collapsible variant="ghost">
          <Collapsible.Trigger>
            <span
              style={{
                "font-size": "var(--kilo-font-size-12)",
                "font-weight": "500",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              {language.t("settings.providers.disabled")}
            </span>
            <Collapsible.Arrow />
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Card style={{ "margin-top": "8px" }}>
              <div
                style={{
                  "font-size": "var(--kilo-font-size-12)",
                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                  "padding-bottom": "8px",
                  "border-bottom": "1px solid var(--border-weak-base)",
                }}
              >
                {language.t("settings.providers.disabled.description")}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  "align-items": "center",
                  padding: "8px 0",
                  "border-bottom": disabledProviders().length > 0 ? "1px solid var(--border-weak-base)" : "none",
                }}
              >
                <div style={{ flex: 1 }}>
                  <Select
                    options={disabledOptions()}
                    current={disabled()}
                    value={(item) => item.value}
                    label={(item) => item.label}
                    onSelect={(item) => setDisabled(item)}
                    variant="secondary"
                    triggerVariant="settings"
                    placeholder={language.t("settings.providers.select.placeholder")}
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const item = disabled()
                    if (!item) return
                    disableProvider(item.value)
                    setDisabled(undefined)
                  }}
                  disabled={!disabled()}
                >
                  {language.t("common.add")}
                </Button>
              </div>
              <For each={disabledProviders()}>
                {(id, index) => (
                  <div
                    style={{
                      display: "flex",
                      "flex-wrap": "wrap",
                      "align-items": "center",
                      "justify-content": "space-between",
                      gap: "16px",
                      "min-height": "56px",
                      padding: "12px 0",
                      "border-bottom":
                        index() < disabledProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", "align-items": "center", gap: "12px", "min-width": 0 }}>
                      <ProviderIcon id={providerIcon(id)} width={20} height={20} />
                      <span
                        style={{
                          "font-size": "var(--kilo-font-size-14)",
                          "font-weight": "500",
                          color: "var(--vscode-foreground)",
                          overflow: "hidden",
                          "text-overflow": "ellipsis",
                          "white-space": "nowrap",
                        }}
                      >
                        {disabledName(id)}
                      </span>
                      <Tag>{language.t("settings.providers.disabled")}</Tag>
                    </div>
                    <Button size="large" variant="ghost" onClick={() => enableProvider(index())}>
                      {language.t("settings.providers.disabled.enable")}
                    </Button>
                  </div>
                )}
              </For>
            </Card>
          </Collapsible.Content>
        </Collapsible>
      </div>
    </div>
  )
}

export default ProvidersTab
