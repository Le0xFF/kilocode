// ============================================
// Local types — NOT from the SDK / API
// ============================================
// These types are specific to the VS Code extension and don't have
// equivalents in @kilocode/sdk. All API types (Session, Event, Agent,
// McpStatus, Config, etc.) should be imported from "@kilocode/sdk/v2/client".

import type { IndexingStatus as SdkIndexingStatus } from "@kilocode/sdk/v2/client"

/** Connection config used by the extension to reach the local CLI server */
export interface ServerConfig {
  baseUrl: string
  password: string
}

// Provider OAuth types
interface ProviderAuthAuthorization {
  url: string
  method: "auto" | "code"
  instructions: string
}

export type IndexingStatus = SdkIndexingStatus

/** VS Code editor context sent alongside messages to the CLI backend */
interface WorktreeFileDiff {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export interface EditorContext {
  /** Workspace-relative paths of currently visible editors */
  visibleFiles?: string[]
  /** Workspace-relative paths of open tabs */
  openTabs?: string[]
  /** Workspace-relative path of the active editor file */
  activeFile?: string
  /** User's default shell (from vscode.env.shell) */
  shell?: string
}
