/**
 * Kilo TUI Commands
 *
 * Provides the /indexing command for configuring codebase indexing, plus the upstream /about command.
 */

import { createMemo } from "solid-js"
import { useBindings } from "@tui/keymap"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"

import { DialogIndexing } from "./components/dialog-indexing.js"
import { showAboutDialog } from "./cli/cmd/tui/component/dialog-about.js" // kilocode_change - upstream About dialog adopted offline
import { indexingEnabled } from "./indexing-feature"

// These types are OpenCode-internal and imported at runtime
type UseSDK = any

/**
 * Register Kilo TUI commands
 * Call this from a component inside the TUI app
 *
 * @param useSDK - OpenCode's useSDK hook (passed from TUI context)
 */
export function registerKiloCommands(useSDK: () => UseSDK) {
  const sync = useSync()
  const dialog = useDialog()

  const indexing = createMemo(() => indexingEnabled(sync.data.config))

  useBindings(() => ({
    commands: [

      ...(indexing()
        ? [
            {
              name: "kilo.indexing",
              title: "Indexing",
              desc: "Configure codebase indexing",
              category: "Kilo",
              slashName: "indexing",
              slashAliases: ["index", "embedding"],
              run: () => {
                dialog.replace(() => <DialogIndexing useSDK={useSDK} />)
              },
            },
          ]
        : []),
      // kilocode_change start - upstream /about command (offline-safe: version/env/diagnostics only)
      {
        name: "kilo.about",
        title: "About",
        desc: "Show version, environment, and diagnostic info",
        category: "Kilo",
        slashName: "about",
        run: () => {
          showAboutDialog(dialog)
        },
      },
      // kilocode_change end
    ].map((command) => ({
      namespace: "palette",
      ...command,
    })),
  }))
}