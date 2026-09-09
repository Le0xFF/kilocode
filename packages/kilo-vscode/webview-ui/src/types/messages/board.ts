import type { SessionBoard } from "@kilocode/sdk/v2/client"

export type { SessionBoard } from "@kilocode/sdk/v2/client"

export interface RequestSessionBoardMessage {
  type: "requestSessionBoard"
  sessionID: string
  requestID: string
  projectId?: string
  before?: string
  // kilocode_change - board pagination limit is a number per the regenerated SDK contract
  limit?: number
}

export interface ResetSessionBoardMessage {
  type: "resetSessionBoard"
  sessionID: string
  requestID: string
  projectId?: string
  // kilocode_change - board revision is a numeric counter per the regenerated SDK contract
  revision: number
}

export interface SessionBoardLoadedMessage {
  type: "sessionBoardLoaded"
  sessionID: string
  requestID: string
  projectId?: string
  board?: SessionBoard
  error?: string
}
