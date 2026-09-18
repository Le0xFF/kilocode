import { createContext, createSignal, type ParentComponent, type Accessor } from "solid-js"
import { useVSCode } from "./vscode"

// kilocode_change - offline surface: remote/cloud notifications were removed with the
// online notification service. This provider keeps the upstream component contract so
// webview code that references it still renders (with an always-empty list); the host
// handler for requestNotifications is a no-op.

interface NotificationsContextValue {
  notifications: Accessor<unknown[]>
  filteredNotifications: Accessor<unknown[]>
  dismiss: (id: string) => void
}

export const NotificationsContext = createContext<NotificationsContextValue>()

export const NotificationsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [notifications, setNotifications] = createSignal<unknown[]>([])
  const [dismissedIds, setDismissedIds] = createSignal<string[]>([])

  const unsubscribe = vscode.onMessage((message: { type?: string }) => {
    if (message.type === "notificationsLoaded") {
      const m = message as { notifications?: unknown[]; dismissedIds?: string[] }
      setNotifications(m.notifications ?? [])
      setDismissedIds(m.dismissedIds ?? [])
    }
  })

  void vscode.postMessage({ type: "requestNotifications" })

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        filteredNotifications: () => {
          const dismissed = dismissedIds()
          return notifications().filter((n) => {
            const id = (n as { id?: string })?.id
            return id ? !dismissed.includes(id) : true
          })
        },
        dismiss: (id: string) => {
          setDismissedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
          void vscode.postMessage({ type: "dismissNotification", notificationId: id })
        },
      }}
    >
      {props.children}
    </NotificationsContext.Provider>
  )
}