import * as vscode from "vscode"
import { KiloProvider } from "./KiloProvider"
import { AgentManagerProvider } from "./agent-manager/AgentManagerProvider"
import { VscodeHost } from "./agent-manager/vscode-host"
import { DiffViewerProvider } from "./diff/DiffViewerProvider"
import { DocumentViewerProvider } from "./DocumentViewerProvider"
import { DiffSourceCatalog } from "./diff/sources/catalog"
import { DiffVirtualProvider } from "./DiffVirtualProvider"
import { SettingsEditorProvider } from "./SettingsEditorProvider"
import { SubAgentViewerProvider } from "./SubAgentViewerProvider"
import { EXTENSION_DISPLAY_NAME } from "./constants"
import { KiloConnectionService } from "./services/cli-backend"
import { AttentionService } from "./services/attention"
import { BrowserAutomationService } from "./services/browser-automation"
import { registerCommitMessageService } from "./services/commit-message"
import { registerCodeActions, registerTerminalActions, KiloCodeActionProvider } from "./services/code-actions"
import { registerToggleAutoApprove } from "./commands/toggle-auto-approve"
import { registerHeapSnapshot } from "./commands/heap-snapshot"
import { markWorkspace } from "./util/spotlight"
import { createNotebookBridge } from "./services/notebook"
import { createGitExecutable } from "./util/git-executable"
import { isCursorHost } from "./utils"

let agentManager: AgentManagerProvider | undefined
let shuttingDown = false

const RESTORE_KEY = "kilo.workbench.restore"

type RestoreState = {
  agentManager?: boolean
}

const panelTitleHandler = (panel: vscode.WebviewPanel) => (title: string) => {
  panel.title = title || EXTENSION_DISPLAY_NAME
}

// Activated via "onStartupFinished" and "onUri" (package.json) so that commands, code actions,
// keybindings, commit-message generation, and URI deep links all work immediately —
// without requiring the user to open a Kilo sidebar or panel first. The CLI backend is NOT spawned here;
// it starts lazily when a webview connects.
export async function activate(context: vscode.ExtensionContext) {
  console.log("Kilo Code extension is now active")
  shuttingDown = false

  // Drives the "!kilo-code.new.isCursor" guards on the native view/title and
  // editor/title menu contributions — see isCursorHost() for why.
  void vscode.commands.executeCommand("setContext", "kilo-code.new.isCursor", isCursorHost())

  // Create shared connection service (one server for all webviews)
  const connectionService = new KiloConnectionService(context)
  const notebookBridge = createNotebookBridge(connectionService)
  let restore = context.workspaceState.get<RestoreState>(RESTORE_KEY) ?? {}
  const remember = (patch: RestoreState) => {
    const next = { ...restore, ...patch }
    if (shuttingDown && patch.agentManager === false) next.agentManager = restore.agentManager
    restore = next
    void context.workspaceState.update(RESTORE_KEY, restore)
  }

  // Create browser automation service (manages Playwright MCP registration)
  const browserAutomationService = new BrowserAutomationService(connectionService)
  browserAutomationService.syncWithSettings()

  // Re-register browser automation MCP server on CLI backend reconnect.
  const unsubscribeStateChange = connectionService.onStateChange((state) => {
    if (state === "connected") {
      browserAutomationService.reregisterIfEnabled()
    }
  })

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    void markWorkspace(folder.uri.fsPath, (msg) => console.warn(`[Kilo New] ${msg}`))
  }

  // Track all open tab panel providers so toolbar button commands can target them.
  // NOTE: The editor/title toolbar for tab panels intentionally omits Agent Manager
  // (unlike the sidebar). Too many icons causes VS Code to collapse them into a
  // "..." overflow menu, hiding important buttons like Settings.
  const tabPanels = new Map<vscode.WebviewPanel, KiloProvider>()
  const activeTabProvider = () => {
    for (const [panel, p] of tabPanels) {
      if (panel.active) return p
    }
    return undefined
  }

  // Create the provider with shared service
  const provider = new KiloProvider(context.extensionUri, connectionService, context, {
    focusContext: "kilo-code.new.sidebarFocused",
  })

  // Register the webview view provider for the sidebar.
  // retainContextWhenHidden keeps the webview alive when switching to other sidebar panels.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(KiloProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  // Ensure Agent Manager navigation keybindings work when a VS Code terminal has focus.
  // The terminal intercepts all keystrokes unless the command is listed in
  // terminal.integrated.commandsToSkipShell, which only contains built-in
  // commands by default.
  const skip = [
    "kilo-code.new.agentManagerOpen",
    "kilo-code.new.agentManager.showTerminal",
    "kilo-code.new.agentManager.previousTerminal",
    "kilo-code.new.agentManager.nextTerminal",
  ]
  if (process.platform === "darwin") skip.push("kilo-code.new.agentManager.runScript")
  ensureCommandsSkipShell(skip)

  // Create Agent Manager provider for editor panel
  const agentManagerHost = new VscodeHost(context.extensionUri, connectionService, context)
  const git = createGitExecutable({
    preferred: async () => {
      const extension = vscode.extensions.getExtension("vscode.git")
      if (!extension) return undefined
      if (!extension.isActive) await extension.activate()
      return extension.exports?.getAPI(1).git.path
    },
    log: (message) => console.warn(`[Kilo New] ${message}`),
  })
  const binary = process.platform === "win32" ? await git() : git
  const agentManagerProvider = new AgentManagerProvider(agentManagerHost, connectionService, binary)
  agentManagerProvider.onPanelVisibilityChange((visible) => remember({ agentManager: visible }))
  agentManager = agentManagerProvider
  context.subscriptions.push(agentManagerProvider)

  // Wire "Continue in Worktree" from sidebar → Agent Manager
  provider.setContinueInWorktreeHandler((sessionId, progress) =>
    agentManagerProvider.continueFromSidebar(sessionId, progress),
  )
  provider.setCreateWorktreeHandler((baseBranch, branchName) =>
    agentManagerProvider.createFromSidebar(baseBranch, branchName),
  )

  // Register toggle auto-approve shortcut (Ctrl+Alt+A / Cmd+Alt+A)
  const defaultDir = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
  const autoApprove = registerToggleAutoApprove(
    context,
    connectionService,
    (sessionId) => {
      if (sessionId) {
        const dir =
          provider.getSessionDirectories().get(sessionId) ?? agentManagerProvider.getSessionDirectories().get(sessionId)
        if (dir) return dir
      }
      return defaultDir()
    },
    () => {
      const dirs = new Set([defaultDir()])
      for (const dir of provider.getSessionDirectories().values()) dirs.add(dir)
      for (const dir of agentManagerProvider.getSessionDirectories().values()) dirs.add(dir)
      return [...dirs]
    },
  )
  const attention = new AttentionService(connectionService, {
    approve: (event, directory) => autoApprove.approve(event, directory),
  })

  provider.setAutoApproveController(autoApprove)
  agentManagerHost.setAutoApproveController(autoApprove)

  // Register serializer so Agent Manager restores when VS Code restarts
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(AgentManagerProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        if (restore.agentManager === false) {
          panel.dispose()
          return Promise.resolve()
        }
        const ctx = agentManagerHost.wrapExistingPanel(panel, {
          onBeforeMessage: (msg) => agentManagerProvider.handleMessage(msg),
          worktreeDirectories: () => agentManagerProvider.getWorktreeDirectories(),
          workspaceRoot: () => agentManagerProvider.workspaceRoot(),
          projectId: () => agentManagerProvider.projectId(),
        })
        agentManagerProvider.deserializePanel(ctx)
        return Promise.resolve()
      },
    }),
  )

  // Register serializer so "Open in Tab" restores when VS Code restarts
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("kilo-code.new.TabPanel", {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        const tabProvider = new KiloProvider(context.extensionUri, connectionService, context, {
          tabTitle: panelTitleHandler(panel),
          topBarSurface: "tab",
        })
        tabProvider.setAutoApproveController(autoApprove)
        tabProvider.setContinueInWorktreeHandler((sessionId, progress) =>
          agentManagerProvider.continueFromSidebar(sessionId, progress),
        )
        tabProvider.setCreateWorktreeHandler((baseBranch, branchName) =>
          agentManagerProvider.createFromSidebar(baseBranch, branchName),
        )
        tabProvider.setDiffVirtualProvider(diffVirtualProvider)
        tabProvider.resolveWebviewPanel(panel)
        tabPanels.set(panel, tabProvider)
        panel.onDidDispose(
          () => {
            console.log("[Kilo New] Tab panel restored from restart disposed")
            tabPanels.delete(panel)
            tabProvider.dispose()
          },
          null,
          context.subscriptions,
        )
        return Promise.resolve()
      },
    }),
  )

  const diffSourceCatalog = new DiffSourceCatalog(connectionService)
  context.subscriptions.push(diffSourceCatalog)
  const diffViewerProvider = new DiffViewerProvider(context.extensionUri, connectionService, diffSourceCatalog, {
    sessionIdProvider: () => provider.getCurrentSessionId(),
    sessionDirectoryProvider: (sessionId) => provider.getSessionGitDirectory(sessionId),
  })
  diffViewerProvider.setCommentHandler((comments, autoSend) => {
    void provider.appendReviewComments(comments, autoSend)
  })
  provider.setDiffViewerProvider(diffViewerProvider)
  context.subscriptions.push(diffViewerProvider)

  const documentViewerProvider = new DocumentViewerProvider(context.extensionUri, connectionService, {
    onComments: (comments, autoSend) => void provider.appendReviewComments(comments, autoSend),
  })
  provider.setDocumentViewerProvider(documentViewerProvider)
  context.subscriptions.push(documentViewerProvider)

  // Create diff virtual provider (lightweight single-file diff for permission approval)
  const diffVirtualProvider = new DiffVirtualProvider(context.extensionUri)
  provider.setDiffVirtualProvider(diffVirtualProvider)
  agentManagerHost.setDiffVirtualProvider(diffVirtualProvider)
  context.subscriptions.push(diffVirtualProvider)

  // Create standalone editor providers (open in editor area, not sidebar)
  const settingsEditorProvider = new SettingsEditorProvider(context.extensionUri, connectionService, context, {
    ...agentManagerProvider.settings,
  })
  context.subscriptions.push(settingsEditorProvider)

  // Create sub-agent viewer provider (read-only editor panel for sub-agent sessions)
  const subAgentViewerProvider = new SubAgentViewerProvider(context.extensionUri, connectionService, context)
  context.subscriptions.push(subAgentViewerProvider)

  // Register serializers so standalone panels restore on restart
  const settingsViews = ["settingsPanel"] as const
  for (const suffix of settingsViews) {
    context.subscriptions.push(
      vscode.window.registerWebviewPanelSerializer(`kilo-code.new.${suffix}`, {
        deserializeWebviewPanel(panel: vscode.WebviewPanel) {
          settingsEditorProvider.deserializePanel(panel)
          return Promise.resolve()
        },
      }),
    )
  }

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(DocumentViewerProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        panel.dispose()
        return Promise.resolve()
      },
    }),
  )

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(DiffViewerProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        diffViewerProvider.deserializePanel(panel)
        return Promise.resolve()
      },
    }),
  )

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("kilo-code.new.SubAgentViewerPanel", {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        // Sub-agent viewer requires a session ID that can't be recovered
        // after restart, so dispose the stale panel cleanly.
        panel.dispose()
        return Promise.resolve()
      },
    }),
  )

  const track = (command: string) => {
    void vscode.commands.executeCommand(command)
  }

  // Register toolbar button command handlers
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.sidebarTitle.plusButtonClicked", () => {
      track("kilo-code.new.plusButtonClicked")
    }),
    vscode.commands.registerCommand("kilo-code.new.sidebarTitle.historyButtonClicked", () => {
      track("kilo-code.new.historyButtonClicked")
    }),
    vscode.commands.registerCommand("kilo-code.new.sidebarTitle.agentManagerOpen", () => {
      track("kilo-code.new.agentManagerOpen")
    }),
    vscode.commands.registerCommand("kilo-code.new.sidebarTitle.settingsButtonClicked", () => {
      track("kilo-code.new.settingsButtonClicked")
    }),
    vscode.commands.registerCommand("kilo-code.new.plusButtonClicked", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "plusButtonClicked" })
      else provider.postMessage({ type: "action", action: "plusButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManagerOpen", () => {
      agentManagerProvider.openPanel()
    }),
    vscode.commands.registerCommand("kilo-code.new.historyButtonClicked", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "historyButtonClicked" })
      else provider.postMessage({ type: "action", action: "historyButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.cycleAgentMode", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "cycleAgentMode" })
      else provider.postMessage({ type: "action", action: "cycleAgentMode" })
      agentManagerProvider.postMessage({ type: "action", action: "cycleAgentMode" })
    }),
    vscode.commands.registerCommand("kilo-code.new.cyclePreviousAgentMode", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
      else provider.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
      agentManagerProvider.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
    }),
    vscode.commands.registerCommand("kilo-code.new.settingsButtonClicked", (tab?: string, projectId?: string) => {
      settingsEditorProvider.openPanel("settings", tab, projectId)
    }),
    vscode.commands.registerCommand("kilo-code.new.openIndexingSettings", () => {
      settingsEditorProvider.openPanel("settings", "indexing")
    }),
    vscode.commands.registerCommand("kilo-code.new.showMemory", async () => {
      if (agentManagerProvider.isActive()) {
        await agentManagerProvider.showMemory()
        return
      }
      const target = activeTabProvider() ?? provider
      if (target === provider) await vscode.commands.executeCommand("kilo-code.SidebarProvider.focus")
      await target.waitForReady()
      await target.showMemory()
    }),
    vscode.commands.registerCommand("kilo-code.new.toggleMemory", async () => {
      if (agentManagerProvider.isActive()) {
        await agentManagerProvider.toggleMemory()
        return
      }
      const target = activeTabProvider() ?? provider
      if (target === provider) await vscode.commands.executeCommand("kilo-code.SidebarProvider.focus")
      await target.waitForReady()
      await target.toggleMemory()
    }),
    // legacy-migration start
    vscode.commands.registerCommand("kilo-code.new.openMigrationWizard", () => {
      provider.postMessage({ type: "migrationState", needed: true, source: "legacy" })
    }),
    // legacy-migration end
    vscode.commands.registerCommand("kilo-code.new.generateTerminalCommand", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Describe the terminal command you want to generate",
        placeHolder: "e.g., find all .ts files modified in the last 24 hours",
      })
      if (!input) return
      await vscode.commands.executeCommand("kilo-code.SidebarProvider.focus")
      await provider.waitForReady()
      provider.postMessage({ type: "triggerTask", text: `Generate a terminal command: ${input}` })
    }),
    vscode.commands.registerCommand("kilo-code.new.openInTab", () => {
      return openKiloInNewTab(
        context,
        connectionService,
        agentManagerProvider,
        tabPanels,
        diffVirtualProvider,
        autoApprove,
      )
    }),
    vscode.commands.registerCommand(
      "kilo-code.new.showChanges",
      (arg?: { sessionId?: string; turnId?: string; initialSourceId?: string; directory?: string }) => {
        diffViewerProvider.openFromCommand(arg)
      },
    ),
    vscode.commands.registerCommand(
      "kilo-code.new.openSubAgentViewer",
      (sessionID: string, title?: string, directory?: string) => {
        subAgentViewerProvider.openPanel(sessionID, title, directory)
      },
    ),
    vscode.commands.registerCommand("kilo-code.new.agentManager.previousSession", () => {
      agentManagerProvider.postMessage({ type: "action", action: "sessionPrevious" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.nextSession", () => {
      agentManagerProvider.postMessage({ type: "action", action: "sessionNext" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.previousTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "tabPrevious" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.nextTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "tabNext" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.previousTerminal", () => {
      agentManagerProvider.postMessage({ type: "action", action: "terminalPrevious" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.nextTerminal", () => {
      agentManagerProvider.postMessage({ type: "action", action: "terminalNext" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.search", () => {
      agentManagerProvider.postMessage({ type: "action", action: "search" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.showTerminal", () => {
      // Route through the webview so it can reach into the active session
      // state and open the VS Code integrated terminal for it.
      agentManagerProvider.postMessage({ type: "action", action: "showTerminal" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.runScript", () => {
      agentManagerProvider.postMessage({ type: "action", action: "runScript" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.toggleDiff", () => {
      agentManagerProvider.postMessage({ type: "action", action: "toggleDiff" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.showShortcuts", () => {
      agentManagerProvider.postMessage({ type: "action", action: "showShortcuts" })
    }),

    vscode.commands.registerCommand("kilo-code.new.agentManager.newTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newTab" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.newTerminalTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newTerminalTab" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.newSideTerminal", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newSideTerminal" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.closeTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "closeTab" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.newWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newWorktree" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.quickWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "quickWorktree" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.openWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "openWorktree" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.openPR", () => {
      agentManagerProvider.postMessage({ type: "action", action: "openPR" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.closeWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "closeWorktree" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManager.advancedWorktree", () =>
      agentManagerProvider.openAdvancedWorktree(),
    ),
    ...Array.from({ length: 9 }, (_, i) =>
      vscode.commands.registerCommand(`kilo-code.new.agentManager.jumpTo${i + 1}`, () => {
        agentManagerProvider.postMessage({ type: "action", action: `jumpTo${i + 1}` })
      }),
    ),
  )

  // Register URI handler for extension deep links (vscode://kilocode.kilo-code/kilocode/...)
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        if (uri.path !== "/kilocode/switch" && uri.path !== "/kilocode/model") return
        const params = new URLSearchParams(uri.query)
        const modelID = params.get("model") || undefined
        const agent = params.get("agent") || undefined
        if (!modelID && !agent) return
        console.log("[Kilo New] URI handler: applying linked selection:", { modelID, agent })
        await vscode.commands.executeCommand(`${KiloProvider.viewType}.focus`)
        provider.postMessage({ type: "selectKiloModel", ...(modelID && { modelID }), ...(agent && { agent }) })
      },
    }),
  )

  // Register commit message generation
  registerCommitMessageService(context, connectionService)

  registerHeapSnapshot(context, connectionService)

  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.reload", () => {
      provider.reload().catch((e) => console.error("[Kilo New] reload command failed:", e))
    }),
  )

  // Register code actions (editor context menus, terminal context menus, keyboard shortcuts)
  registerCodeActions(context, provider, agentManagerProvider, activeTabProvider)
  registerTerminalActions(context, provider, agentManagerProvider)

  // Register CodeActionProvider (lightbulb quick fixes)
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new KiloCodeActionProvider(),
      KiloCodeActionProvider.metadata,
    ),
  )

  // Dispose services when extension deactivates (kills the server)
  context.subscriptions.push({
    dispose: () => {
      shuttingDown = true
      unsubscribeStateChange()
      attention.dispose()
      browserAutomationService.dispose()
      provider.dispose()
      notebookBridge.dispose()
      connectionService.dispose()
    },
  })
}

export async function deactivate() {
  shuttingDown = true
  await agentManager?.shutdown()
}

function openKiloInNewTab(
  context: vscode.ExtensionContext,
  connectionService: KiloConnectionService,
  agentManagerProvider: AgentManagerProvider,
  tabPanels: Map<vscode.WebviewPanel, KiloProvider>,
  diffVirtualProvider: DiffVirtualProvider,
  autoApprove: ReturnType<typeof registerToggleAutoApprove>,
) {
  const panel = vscode.window.createWebviewPanel(
    "kilo-code.new.TabPanel",
    EXTENSION_DISPLAY_NAME,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [context.extensionUri],
    },
  )

  panel.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "kilo-light.svg"),
    dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "kilo-dark.svg"),
  }

  const tabProvider = new KiloProvider(context.extensionUri, connectionService, context, {
    tabTitle: panelTitleHandler(panel),
    topBarSurface: "tab",
  })
  tabProvider.setAutoApproveController(autoApprove)
  tabProvider.setContinueInWorktreeHandler((sessionId, progress) =>
    agentManagerProvider.continueFromSidebar(sessionId, progress),
  )
  tabProvider.setCreateWorktreeHandler((baseBranch, branchName) =>
    agentManagerProvider.createFromSidebar(baseBranch, branchName),
  )
  tabProvider.setDiffVirtualProvider(diffVirtualProvider)
  tabProvider.resolveWebviewPanel(panel)
  tabPanels.set(panel, tabProvider)

  panel.onDidDispose(
    () => {
      console.log("[Kilo New] Tab panel disposed")
      tabPanels.delete(panel)
      tabProvider.dispose()
    },
    null,
    context.subscriptions,
  )
}

/**
 * Add extension commands to terminal.integrated.commandsToSkipShell so they
 * work when a VS Code terminal has focus. The setting only ships with built-in
 * commands; extension commands must be added explicitly.
 */
function ensureCommandsSkipShell(commands: string[]): void {
  const config = vscode.workspace.getConfiguration("terminal.integrated")
  const info = config.inspect<string[]>("commandsToSkipShell")
  // Update whichever scope already carries an override so we don't
  // shadow workspace settings or leak workspace values into global.
  const [existing, target] = info?.workspaceFolderValue
    ? [info.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder]
    : info?.workspaceValue
      ? [info.workspaceValue, vscode.ConfigurationTarget.Workspace]
      : [info?.globalValue ?? [], vscode.ConfigurationTarget.Global]
  const missing = commands.filter((cmd) => !existing.includes(cmd))
  if (missing.length === 0) return
  config.update("commandsToSkipShell", [...existing, ...missing], target)
}
