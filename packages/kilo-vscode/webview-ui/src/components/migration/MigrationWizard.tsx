import { Show, createSignal, onMount, onCleanup } from "solid-js"
import type { Component, JSX } from "solid-js"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import SessionMigrationProgress, { type SessionMigrationProgressState } from "./SessionMigrationProgress"
import SessionMigrationSummary from "./SessionMigrationSummary"
import ForceReimportDialog from "./ForceReimportDialog"
import RunningMigrationDialog from "./RunningMigrationDialog"
import {
  createSessionItem,
  createSessionSummary,
  updateSessionSummary,
  type SessionSummaryState,
} from "./session-migration-summary-state"
import type {
  MigrationSessionInfo,
  MigrationSessionSelection,
  MigrationResultItem,
  MigrationDataMessage,
  MigrationProgressMessage,
  MigrationSessionProgressMessage,
  MigrationCompleteMessage,
  MigrationSource,
} from "../../types/messages"
import "./migration.css"

const KiloLogo = (): JSX.Element => {
  const iconsBaseUri = (window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI || ""
  const isLight =
    document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light")
  const icon = isLight ? "kilo-light.svg" : "kilo-dark.svg"
  return (
    <div class="migration-wizard__logo">
      <img src={`${iconsBaseUri}/${icon}`} alt="Kilo Code" />
    </div>
  )
}

const CheckmarkSvg = (): JSX.Element => (
  <svg viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="2.5 6 5 8.5 9.5 3.5" />
  </svg>
)

const SuccessCheckSvg = (): JSX.Element => (
  <svg
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polyline points="2.5 6 5 8.5 9.5 3.5" />
  </svg>
)

const ErrorXSvg = (): JSX.Element => (
  <svg
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <line x1="3" y1="3" x2="9" y2="9" />
    <line x1="9" y1="3" x2="3" y2="9" />
  </svg>
)

const WarningSvg = (): JSX.Element => (
  <svg
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <line x1="6" y1="4" x2="6" y2="7" />
    <line x1="6" y1="9" x2="6" y2="9.01" />
  </svg>
)

// Inline SVG icons for the What's New feature cards
const BoltIcon = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
)

const MonitorIcon = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
)

const UsersIcon = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

const ServerIcon = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect x="2" y="12" width="20" height="8" rx="2" />
    <path d="M6 12V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" />
    <line x1="12" y1="16" x2="12" y2="16.01" />
  </svg>
)

type MigratePhase = "selecting" | "migrating" | "error" | "done"
type Screen = "whats-new" | "migrate"

interface ProgressEntry {
  item: string
  status: "pending" | "migrating" | "success" | "warning" | "error"
  message?: string
}

export interface MigrationWizardProps {
  source?: MigrationSource
  operationId?: string
  onBack: () => void
  onComplete: () => void
}

const MigrationWizard: Component<MigrationWizardProps> = (props) => {
  const vscode = useVSCode()
  const dialog = useDialog()
  const language = useLanguage()
  const source = props.source ?? "roo"
  const operationId = props.operationId ?? crypto.randomUUID()
  // kilocode_change - offline: the What's New intro screen is hidden by default; the migration migrate-screen is the active one
  const [screen, setScreen] = createSignal<Screen>("migrate")
  const [phase, setPhase] = createSignal<MigratePhase>("selecting")
  const [sessions, setSessions] = createSignal<MigrationSessionInfo[]>([])
  const [selected, setSelected] = createSignal(false)
  const [entries, setEntries] = createSignal<ProgressEntry[]>([])
  const [results, setResults] = createSignal<MigrationResultItem[]>([])
  const [progress, setProgress] = createSignal<SessionMigrationProgressState | undefined>(undefined)
  const [summary, setSummary] = createSignal<SessionSummaryState>(createSessionSummary())
  const running = () => phase() === "migrating"

  onMount(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data
      if (msg?.source !== source || msg?.operationId !== operationId) return
      if (msg.type === "migrationData") {
        const data = (msg as MigrationDataMessage).data
        setSessions(data.sessions ?? [])
        setSelected((data.sessions?.length ?? 0) > 0)
      }

      if (msg.type === "migrationProgress") {
        const update = msg as MigrationProgressMessage
        setEntries((prev) => {
          const entry = { item: update.item, status: update.status, message: update.message }
          return prev.some((item) => item.item === update.item)
            ? prev.map((item) => (item.item === update.item ? entry : item))
            : [...prev, entry]
        })
      }

      if (msg.type === "migrationSessionProgress") {
        const update = msg as MigrationSessionProgressMessage
        setSummary((prev) => updateSessionSummary(prev, createSessionItem(update.session, update.error), update.phase))
        setProgress({
          session: update.session,
          index: update.index,
          total: update.total,
          phase: update.phase,
          error: update.error,
        })
      }

      if (msg.type === "migrationComplete") {
        const complete = msg as MigrationCompleteMessage
        setResults(complete.results.filter((item) => item.category === "session"))
        const errors = results().some((item) => item.status === "error")
        setPhase(errors ? "error" : "done")
        if (!errors) vscode.postMessage({ type: "loadSessions" })
      }
    }

    window.addEventListener("message", handler)
    vscode.postMessage({ type: "requestMigrationData", source, operationId })
    onCleanup(() => window.removeEventListener("message", handler))
  })

  const start = (sessions: MigrationSessionSelection[]) => {
    setEntries(sessions.map((session) => ({ item: session.id, status: "pending" })))
    setResults([])
    setProgress(undefined)
    setPhase("migrating")
    vscode.postMessage({
      type: "startMigration",
      source,
      operationId,
      selections: { sessions },
    })
  }

  const migrate = () => {
    if (!selected() || sessions().length === 0 || running()) return
    setSummary(createSessionSummary())
    start(sessions().map((session) => ({ id: session.id })))
  }

  const force = (ids: string[]) => {
    if (running() || ids.length === 0) return
    dialog.show(() => (
      <ForceReimportDialog
        count={ids.length}
        onConfirm={() => {
          start(ids.map((id) => ({ id, force: true })))
          showToast({ variant: "success", title: language.t("migration.forceReimport.toast.started") })
        }}
      />
    ))
  }

  const back = () => {
    if (!running()) {
      props.onBack()
      return
    }
    dialog.show(() => <RunningMigrationDialog onConfirm={() => props.onBack()} />)
  }

  const done = () => {
    vscode.postMessage({ type: "loadSessions" })
    props.onComplete()
  }

  const status = (): ProgressEntry["status"] => {
    const list = entries()
    if (list.length === 0) return "pending"
    if (running() && list.some((item) => item.status === "migrating" || item.status === "pending")) return "migrating"
    if (list.some((item) => item.status === "error")) return "error"
    if (list.some((item) => item.status === "warning")) return "warning"
    if (list.every((item) => item.status === "success")) return "success"
    if (list.some((item) => item.status === "migrating")) return "migrating"
    return "pending"
  }

  const success = () => results().filter((item) => item.status === "success").length

  const StatusIcon = (): JSX.Element => (
    <>
      <Show when={status() === "pending" && !running()}>
        <div class="migration-wizard__status-icon migration-wizard__status-icon--pending" />
      </Show>
      <Show when={running()}>
        <div class="migration-wizard__status-icon">
          <div class="migration-wizard__spinner" />
        </div>
      </Show>
      <Show when={status() === "success" && !running()}>
        <div class="migration-wizard__status-icon migration-wizard__status-icon--success">
          <SuccessCheckSvg />
        </div>
      </Show>
      <Show when={status() === "warning"}>
        <div class="migration-wizard__status-icon migration-wizard__status-icon--warning">
          <WarningSvg />
        </div>
      </Show>
      <Show when={status() === "error"}>
        <div class="migration-wizard__status-icon migration-wizard__status-icon--error">
          <ErrorXSvg />
        </div>
      </Show>
    </>
  )

  return (
    <div class="migration-wizard">
      <div class="migration-wizard__container">
        <Show when={screen() === "whats-new"}>
          {/* kilocode_change - offline: the What's New intro screen is hidden by default, so its section is not rendered at all */}
          <div class="migration-wizard__screen--active">
            <div class="migration-wizard__header">
              <KiloLogo />
              <h1>{language.t("settings.aboutKiloCode.rooImport.button")}</h1>
              <p>{language.t("settings.aboutKiloCode.rooImport.description")}</p>
            </div>


          <div class="migration-wizard__features">
            <div class="migration-wizard__feature">
              <div class="migration-wizard__feature-icon">
                <BoltIcon />
              </div>
              <div class="migration-wizard__feature-text">
                <div class="title">{language.t("migration.whatsNew.features.performance.title")}</div>
                <div class="detail">{language.t("migration.whatsNew.features.performance.detail")}</div>
              </div>
            </div>

            <div class="migration-wizard__feature">
              <div class="migration-wizard__feature-icon">
                <MonitorIcon />
              </div>
              <div class="migration-wizard__feature-text">
                <div class="title">{language.t("migration.whatsNew.features.interface.title")}</div>
                <div class="detail">{language.t("migration.whatsNew.features.interface.detail")}</div>
              </div>
            </div>

            <div class="migration-wizard__feature">
              <div class="migration-wizard__feature-icon">
                <UsersIcon />
              </div>
              <div class="migration-wizard__feature-text">
                <div class="title">{language.t("migration.whatsNew.features.agentManager.title")}</div>
                <div class="detail">{language.t("migration.whatsNew.features.agentManager.detail")}</div>
              </div>
            </div>

            <div class="migration-wizard__feature">
              <div class="migration-wizard__feature-icon">
                <ServerIcon />
              </div>
              <div class="migration-wizard__feature-text">
                <div class="title">{language.t("migration.whatsNew.features.foundation.title")}</div>
                <div class="detail">{language.t("migration.whatsNew.features.foundation.detail")}</div>
              </div>
            </div>
          </div>

          <div class="migration-wizard__blog-link">
            <span
              class="migration-wizard__link"
              role="link"
              tabIndex={0}
              onClick={() => vscode.postMessage({ type: "openExternal", url: "https://blog.kilo.ai/p/new-kilo-for-vs-code-is-live" })}
              onKeyDown={(e) => {
                if (e.key === "Enter") vscode.postMessage({ type: "openExternal", url: "https://blog.kilo.ai/p/new-kilo-for-vs-code-is-live" })
              }}
            >
              {language.t("migration.whatsNew.blogLink")} <span>&rarr;</span>
            </span>
            <span
              class="migration-wizard__link"
              role="link"
              tabIndex={0}
              onClick={() => vscode.postMessage({ type: "openExternal", url: "https://kilo.ai/docs/code-with-ai/platforms/vscode/whats-new" })}
              onKeyDown={(e) => {
                if (e.key === "Enter") vscode.postMessage({ type: "openExternal", url: "https://kilo.ai/docs/code-with-ai/platforms/vscode/whats-new" })
              }}
            >
              {language.t("migration.whatsNew.docsLink")} <span>&rarr;</span>
            </span>
          </div>

          <div class="migration-wizard__footer">
            <div class="migration-wizard__btn-group">
              <button
                type="button"
                class="migration-wizard__btn migration-wizard__btn--primary"
                onClick={() => props.onComplete()}
              >
                {language.t("migration.whatsNew.continue")}
              </button>
            </div>
          </div>
          </div>
        </Show>

        {/* ---- Screen 2: Migrate Settings ---- */}
        <div class={screen() === "migrate" ? "migration-wizard__screen--active" : "migration-wizard__screen--hidden"}>
          <div class="migration-wizard__header">
            <KiloLogo />
            <h1>{language.t("migration.migrate.title")}</h1>
            <p>{language.t("migration.migrate.subtitle")}</p>
          </div>

          <Show when={sessions().length === 0}>

            <div class="migration-wizard__card">
              <div class="migration-wizard__empty">{language.t("migration.roo.empty")}</div>
            </div>
          </Show>

          <Show when={sessions().length > 0}>
            <div class="migration-wizard__card">
              <Show when={phase() === "done"}>
                <div class={`migration-wizard__summary${success() > 0 ? " migration-wizard__summary--success" : ""}`}>
                  {language.t("migration.complete.summary", {
                    success: String(success()),
                    total: String(results().length),
                  })}
                </div>
              </Show>

              <div class="migration-wizard__section-label">{language.t("migration.migrate.selectLabel")}</div>
              <div class="migration-wizard__item">
                <Show when={phase() === "selecting"} fallback={<StatusIcon />}>
                  <label class="migration-wizard__checkbox">
                    <input
                      type="checkbox"
                      aria-label={language.t("migration.migrate.chatHistory")}
                      checked={selected()}
                      onChange={(event) => setSelected(event.currentTarget.checked)}
                    />
                    <span class="migration-wizard__checkmark">
                      <CheckmarkSvg />
                    </span>
                  </label>
                </Show>
                <div class="migration-wizard__item-text">
                  <div class="label">{language.t("migration.migrate.chatHistory")}</div>
                  <div class="desc">
                    {language.t("migration.migrate.sessionsDetected", { count: String(sessions().length) })}
                  </div>
                  <Show when={selected() && phase() !== "selecting" && progress()}>
                    <Show
                      when={progress()?.phase === "summary"}
                      fallback={<SessionMigrationProgress progress={progress()!} />}
                    >
                      <SessionMigrationSummary summary={summary()} onForce={force} />
                    </Show>
                  </Show>
                </div>
              </div>
            </div>
          </Show>

          <div class="migration-wizard__footer">
            <div class="migration-wizard__btn-group">
              <Show when={phase() === "selecting" || running()}>
                <button type="button" class="migration-wizard__btn migration-wizard__btn--ghost" onClick={back}>
                  {language.t("common.goBack")}
                </button>
                <button
                  type="button"
                  class="migration-wizard__btn migration-wizard__btn--primary"
                  disabled={running() || !selected() || sessions().length === 0}
                  onClick={migrate}
                >
                  {language.t("migration.roo.button")}
                </button>
              </Show>
              <Show when={phase() === "error"}>
                <button
                  type="button"
                  class="migration-wizard__btn migration-wizard__btn--primary"
                  onClick={() => {
                    vscode.postMessage({ type: "loadSessions" })
                    setPhase("done")
                  }}
                >
                  {language.t("migration.error.continue")}
                </button>
              </Show>
              <Show when={phase() === "done"}>
                <button type="button" class="migration-wizard__btn migration-wizard__btn--primary" onClick={done}>
                  {language.t("migration.complete.done")}
                </button>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MigrationWizard
