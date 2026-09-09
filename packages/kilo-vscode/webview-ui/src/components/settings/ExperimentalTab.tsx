import { Component, For, Show, createMemo } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useImageModels } from "../../context/image-models"
import SettingsRow from "./SettingsRow"

const ExperimentalTab: Component = () => {
  const { config, settings, updateConfig, applySetting } = useConfig()
  const language = useLanguage()
  const imageModels = useImageModels()

  const experimental = createMemo(() => config().experimental ?? {})

  const updateExperimental = (key: string, value: unknown) => {
    updateConfig({
      experimental: { ...experimental(), [key]: value },
    })
  }

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.experimental.formatter.title")}
          description={language.t("settings.experimental.formatter.description")}
        >
          <Switch
            checked={config().formatter !== false}
            onChange={(checked) => updateConfig({ formatter: checked ? {} : false })}
            hideLabel
          >
            {language.t("settings.experimental.formatter.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.batch.title")}
          description={language.t("settings.experimental.batch.description")}
        >
          <Switch
            checked={experimental().batch_tool ?? false}
            onChange={(checked) => updateExperimental("batch_tool", checked)}
            hideLabel
          >
            {language.t("settings.experimental.batch.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.imageGeneration.title")}
          description={language.t("settings.experimental.imageGeneration.description")}
        >
          <Switch
            checked={experimental().image_generation ?? false}
            onChange={(checked) => updateExperimental("image_generation", checked)}
            hideLabel
          >
            {language.t("settings.experimental.imageGeneration.title")}
          </Switch>
        </SettingsRow>

        <Show when={experimental().image_generation}>
          <SettingsRow
            title={language.t("settings.experimental.imageGenerationModel.title")}
            description={language.t("settings.experimental.imageGenerationModel.description")}
          >
            <Select
              options={imageModels.models().map((m) => ({ value: m.id, label: m.name }))}
              current={imageModels
                .models()
                .map((m) => ({ value: m.id, label: m.name }))
                .find((m) => m.value === experimental().image_generation_provider?.model)}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => {
                const model = item?.value
                if (!model) {
                  updateExperimental("image_generation_provider", undefined)
                  return
                }
                const [providerID] = model.split("/")
                updateExperimental("image_generation_provider", { provider: providerID, model })
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
              placeholder={language.t("settings.experimental.imageGenerationModel.placeholder")}
            />
          </SettingsRow>
        </Show>

        <SettingsRow
          title={language.t("settings.experimental.sharedAgentBoard.title")}
          description={language.t("settings.experimental.sharedAgentBoard.description")}
        >
          <Switch
            checked={experimental().shared_agent_board ?? false}
            onChange={(checked) => updateExperimental("shared_agent_board", checked)}
            hideLabel
          >
            {language.t("settings.experimental.sharedAgentBoard.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.nativeNotebookTools.title")}
          description={language.t("settings.experimental.nativeNotebookTools.description")}
        >
          <Switch
            checked={experimental().native_notebook_tools ?? false}
            onChange={(checked) => updateExperimental("native_notebook_tools", checked)}
            hideLabel
          >
            {language.t("settings.experimental.nativeNotebookTools.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.continueOnDeny.title")}
          description={language.t("settings.experimental.continueOnDeny.description")}
        >
          <Switch
            checked={experimental().continue_loop_on_deny ?? false}
            onChange={(checked) => updateExperimental("continue_loop_on_deny", checked)}
            hideLabel
          >
            {language.t("settings.experimental.continueOnDeny.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.browser.enable.title")}
          description={language.t("settings.browser.enable.description")}
        >
          <Switch
            checked={settings().browserAutomation === true}
            onChange={(checked) => applySetting("browserAutomation", checked, "experimental.browserAutomation")}
            hideLabel
          >
            {language.t("settings.browser.enable.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.experimental.taskModelSelection.title")}
          description={language.t("settings.experimental.taskModelSelection.description")}
        >
          <Switch
            checked={experimental().task_model_selection ?? false}
            onChange={(checked) => updateExperimental("task_model_selection", checked)}
            hideLabel
          >
            {language.t("settings.experimental.taskModelSelection.title")}
          </Switch>
        </SettingsRow>

        {/* MCP timeout */}
        <SettingsRow
          title={language.t("settings.experimental.mcpTimeout.title")}
          description={language.t("settings.experimental.mcpTimeout.description")}
          last
        >
          <TextField
            value={String(experimental().mcp_timeout ?? 60000)}
            onChange={(val) => {
              const num = parseInt(val, 10)
              if (!isNaN(num) && num > 0) {
                updateExperimental("mcp_timeout", num)
              }
            }}
          />
        </SettingsRow>
      </Card>

      {/* Tool toggles */}
      <Show when={config().tools && Object.keys(config().tools ?? {}).length > 0}>
        <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>
          {language.t("settings.experimental.toolToggles")}
        </h4>
        <Card>
          <For each={Object.entries(config().tools ?? {})}>
            {([name, enabled], index) => (
              <SettingsRow title={name} description="" last={index() >= Object.keys(config().tools ?? {}).length - 1}>
                <Switch
                  checked={enabled}
                  onChange={(checked) => updateConfig({ tools: { ...config().tools, [name]: checked } })}
                  hideLabel
                >
                  {name}
                </Switch>
              </SettingsRow>
            )}
          </For>
        </Card>
      </Show>
    </div>
  )
}

export default ExperimentalTab
