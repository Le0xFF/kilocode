/**
 * Renders New Task, History, Agent Manager, and Settings inside the
 * webview, as a fallback for Cursor only (see isCursorHost() in src/utils.ts).
 * Cursor's Secondary Side Bar support is unreliable for
 * extension-contributed `view/title` toolbars, which render outside the webview
 * DOM with no API to detect or work around the failure. Real VS Code renders the
 * native toolbar fine everywhere, so it keeps using that instead of this bar.
 */

import { Component, For } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import "@vscode/codicons/dist/codicon.css"

export interface SidebarTopBarProps {
  onNewTask: () => void
  onHistory: () => void
}

interface Action {
  key: string
  icon: "plus" | "history" | "organization" | "extensions" | "user" | "settings-gear"
  button: string
  run: () => void
}

export const SidebarTopBar: Component<SidebarTopBarProps> = (props) => {
  const vscode = useVSCode()
  const language = useLanguage()

  // Mirrors the native toolbar buttons; analytics tracking removed.

  // kilocode_change - offline: marketplace/profile/claw panels removed; only agent manager + settings remain
  const open = (type: "openAgentManager" | "openSettingsPanel") => vscode.postMessage({ type })

  const actions: Action[] = [
    { key: "newTask", icon: "plus", button: "new_task", run: () => props.onNewTask() },
    { key: "history", icon: "history", button: "history", run: () => props.onHistory() },
    { key: "agentManager", icon: "organization", button: "agent_manager", run: () => open("openAgentManager") },

    { key: "settings", icon: "settings-gear", button: "settings", run: () => open("openSettingsPanel") },
  ]

  return (
    <div class="sidebar-top-bar" role="toolbar" aria-label={language.t("sidebar.topBar.label")}>
      <For each={actions}>
        {(action) => {
          const label = language.t(`sidebar.topBar.${action.key}`)
          return (
            <Tooltip value={label} placement="bottom">
              <IconButton
                icon={action.icon}
                variant="ghost"
                size="small"
                aria-label={label}
                onClick={() => {
                  action.run()
                }}
              />
            </Tooltip>
          )
        }}
      </For>
    </div>
  )
}
