/**
 * Source contract tests for prompt send paths.
 *
 * Static analysis — reads the session context source and verifies that sendMessage
 * and sendCommand still dismiss suggestions and reject questions before dispatching.
 * Also reads ChatView.tsx and asserts the prompt-block predicate is fed only
 * permission counts, never question counts — guarantees that a pending question
 * cannot re-block the prompt input.
 *
 * Protects against accidental removal during Kilo development.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const SESSION_FILE = path.join(ROOT, "webview-ui/src/context/session.tsx")
const SESSION_TYPES_FILE = path.join(ROOT, "webview-ui/src/context/session-types.ts")
const CHATVIEW_FILE = path.join(ROOT, "webview-ui/src/components/chat/ChatView.tsx")
const AGENT_MANAGER_FILE = path.join(ROOT, "webview-ui/agent-manager/AgentManagerApp.tsx")
const PROMPT_UTILS_FILE = path.join(ROOT, "webview-ui/src/components/chat/prompt-input-utils.ts")
const PROMPT_FILE = path.join(ROOT, "webview-ui/src/components/chat/PromptInput.tsx")
const KILOPROVIDER_FILE = path.join(ROOT, "src/KiloProvider.ts")
const CONNECTION_SERVICE_FILE = path.join(ROOT, "src/services/cli-backend/connection-service.ts")

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8")
}

/**
 * Extract the body of a named function from the source.
 * Finds `function <name>(` and returns everything from there to the next
 * `function ` declaration at the same or lower indentation, or to end of file.
 */
function extractFunctionBody(source: string, name: string): string {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  if (start === -1) return ""

  // Find the next `function ` declaration after the opening one.
  // We search for a newline followed by `  function ` (2-space indent, matching
  // the indentation level of sendMessage/sendCommand inside SessionProvider).
  const rest = source.slice(start + marker.length)
  const next = rest.search(/\n  function /)
  return next === -1 ? rest : rest.slice(0, next)
}

describe("sendMessage dismisses pending tool requests", () => {
  const source = readFile(SESSION_FILE)
  const body = extractFunctionBody(source, "sendMessage")

  it("function sendMessage exists in session.tsx", () => {
    expect(body.length).toBeGreaterThan(0)
  })

  it("dismisses suggestions before sending", () => {
    expect(body).toContain("dismissSuggestion")
  })

  it("rejects questions before sending", () => {
    expect(body).toContain("dismissQuestion")
  })
})

describe("sendCommand dismisses pending tool requests", () => {
  const source = readFile(SESSION_FILE)
  const body = extractFunctionBody(source, "sendCommand")

  it("function sendCommand exists in session.tsx", () => {
    expect(body.length).toBeGreaterThan(0)
  })

  it("dismisses suggestions before sending", () => {
    expect(body).toContain("dismissSuggestion")
  })

  it("rejects questions before sending", () => {
    expect(body).toContain("dismissQuestion")
  })

  it("applies model, agent, and variant overrides when provided by a command", () => {
    expect(body).toContain("if (overrides?.agent)")
    expect(body).toContain("selectAgent(overrides.agent, scope)")
    expect(body).toContain("if (overrides?.model)")
    expect(body).toContain("selectModel(parsed.providerID, parsed.modelID, scope)")
    expect(body).toContain("if (overrides?.variant)")
    expect(body).toContain("selectVariant(overrides.variant, scope)")
  })
})

describe("confirmed queued prompts retain optimistic parts", () => {
  const source = readFile(SESSION_FILE)
  const body = extractFunctionBody(source, "handleMessageCreated")

  it("does not clear optimistic parts before canonical part events arrive", () => {
    expect(body).toContain("Keep placeholder parts until their canonical part.updated events arrive")
    expect(body).not.toContain("delete p[message.id]")
  })
})

describe("static command completion contract", () => {
  const source = readFile(SESSION_FILE)

  it("finishes only the acknowledged command submission", () => {
    const body = extractFunctionBody(source, "handleCommandCompletion")
    expect(body).toMatch(/message\.type === "sessionCommandCompleted"\) finishSubmission\(message\.messageID\)/)
  })

  it("acknowledges aliases after direct command confirmation", () => {
    const provider = readFile(KILOPROVIDER_FILE)
    expect(provider).toMatch(
      /await runWithMessageConfirmation[\s\S]*?if \(messageID && completesWithoutStatus\(command\)\)[\s\S]*?sessionCommandCompleted/,
    )
  })

  it("does not clear every session submission or active abort", () => {
    const body = extractFunctionBody(source, "handleCommandCompletion")
    expect(body).not.toContain("confirmSubmissions")
    expect(body).not.toContain("aborts.clear")
  })
})

describe("ChatView prompt-block contract", () => {
  const source = readFile(CHATVIEW_FILE)

  it("calls isPromptBlocked with exactly one argument (familyPermissions length)", () => {
    // Exact call shape — prettier formatting is deterministic here, so a strict
    // match catches both "someone added a second arg" and "someone wrapped it in
    // a different expression".
    expect(source).toMatch(/blocked\s*=\s*\(\)\s*=>\s*isPromptBlocked\(familyPermissions\(\)\.length\)/)
  })

  it("does not pass any second argument to isPromptBlocked", () => {
    expect(source).not.toMatch(/isPromptBlocked\s*\([^,)]*,[^)]*\)/)
  })

  it("does not define a blockingQuestions memo", () => {
    expect(source).not.toContain("blockingQuestions")
  })

  it("does not reference q.blocking when building the blocked state", () => {
    expect(source).not.toMatch(/q\.blocking/)
  })
})

describe("review worktree visibility contract", () => {
  it("passes the worktree prop from ChatView to PromptInput", () => {
    const source = readFile(CHATVIEW_FILE)
    expect(source).toMatch(/worktree\?: boolean/)
    expect(source).toMatch(/<PromptInput[\s\S]*worktree=\{props\.worktree\}/)
  })

  it("hides review worktree unless PromptInput is explicitly in a worktree", () => {
    const source = readFile(PROMPT_FILE)
    expect(source).toMatch(/worktree\?: boolean/)
    expect(source).toMatch(/if \(props\.worktree !== true\) hidden\.add\("review worktree"\)/)
  })

  it("uses registered worktree membership for Agent Manager visibility", () => {
    const source = readFile(AGENT_MANAGER_FILE)
    expect(source).toMatch(/worktree=\{worktrees\(\)\.some\(\(wt\) => wt\.id === selection\(\)\)\}/)
    expect(source).not.toMatch(/worktree=\{selection\(\(\)\) !== LOCAL\}/)
  })
})

describe("isPromptBlocked signature contract", () => {
  const source = readFile(PROMPT_UTILS_FILE)

  it("declares exactly one parameter (source-level guard)", () => {
    // Complements the runtime `isPromptBlocked.length === 1` check in
    // prompt-input-utils.test.ts. `Function.prototype.length` counts parameters
    // before the first default — this regex catches a future regression that
    // sneaks in a second param with a default value (which would otherwise keep
    // `.length === 1` and slip past the runtime check).
    const match = source.match(/export function isPromptBlocked\(([^)]*)\)/)
    expect(match).not.toBeNull()
    const params = match![1]
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    expect(params).toHaveLength(1)
  })
})

describe("handleSessionDeleted draft cleanup contract", () => {
  const source = readFile(SESSION_FILE)

  it("clears draftSessionID independently of currentSessionID when it equals the deleted id", () => {
    const body = extractFunctionBody(source, "handleSessionDeleted")
    const draftBlock = body.match(/if \(draftSessionID\(\) === sessionID\) \{([\s\S]*?)\}/)
    expect(draftBlock).not.toBeNull()
    expect(draftBlock![1]).toContain("setDraftSessionID(undefined)")
    // Must be a sibling check, not nested inside the currentSessionID branch —
    // otherwise a deleted but non-active session leaves draftSessionID stale.
    const activeBlock = body.match(/if \(currentSessionID\(\) === sessionID\) \{([\s\S]*?)\}/)
    expect(activeBlock![1]).not.toContain("setDraftSessionID")
  })

  it("calls deleteDraftsForSession outside the cleanup batch so PromptInput's recreate is also cleaned up", () => {
    const body = extractFunctionBody(source, "handleSessionDeleted")
    const batchMatch = body.match(/batch\(\(\) => \{([\s\S]*?)\}\)/)
    expect(batchMatch).not.toBeNull()
    expect(batchMatch![1]).not.toContain("deleteDraftsForSession(sessionID)")
    const postBatch = body.slice((batchMatch!.index ?? 0) + batchMatch![0].length)
    expect(postBatch).toContain("deleteDraftsForSession(sessionID)")
  })

  it("removes the deleted id from the loaded Set so cascade/external deletes free the marker", () => {
    // The user-initiated deleteSession() path prunes loaded optimistically, but
    // cascade deletes and external CLI/TUI deletes only come through
    // handleSessionDeleted. Without this, those ids stay in loaded until reload.
    const body = extractFunctionBody(source, "handleSessionDeleted")
    expect(body).toMatch(
      /setLoaded\(\s*\(prev\)\s*=>\s*\{[\s\S]*?prev\.has\(sessionID\)[\s\S]*?next\.delete\(sessionID\)[\s\S]*?\}\)/,
    )
  })

  it("drops respondingPermissions entries that belong to the deleted session", () => {
    // setPermissions is cleared by removeSessionPermissions, but respondingPermissions
    // (the Set of in-flight permission ids) is a separate accessor that doesn't know
    // which ids belong to which session. Without an explicit prune here, a permission
    // request that the user was responding to when the session was deleted would keep
    // its id resident and block future requests with the same id.
    const body = extractFunctionBody(source, "handleSessionDeleted")
    expect(body).toContain("setRespondingPermissions")
  })

  it("prevents late status and attention events from reviving a deleted session", () => {
    expect(extractFunctionBody(source, "handleSessionDeleted")).toContain("removedSessions.add(sessionID)")
    expect(extractFunctionBody(source, "handleSessionStatus")).toContain("removedSessions.has(sessionID)")
    expect(extractFunctionBody(source, "handlePermissionRequest")).toContain(
      "removedSessions.has(permission.sessionID)",
    )
    expect(extractFunctionBody(source, "handleQuestionRequest")).toContain("removedSessions.has(question.sessionID)")
    expect(extractFunctionBody(source, "handleSuggestionRequest")).toContain(
      "removedSessions.has(suggestion.sessionID)",
    )
  })
})

describe("KiloProvider pruneDeletedSession contract", () => {
  const source = readFile(KILOPROVIDER_FILE)

  it("drops sessionStatusMap entries alongside the other per-session caches", () => {
    // sessionStatusMap is the source of truth for the destructive-config busy-session
    // warning (sessionStatusMap.size === 0 short-circuit, the allStatusMap fed to the
    // Settings panel). Without this prune, deleted sessions stay marked as
    // busy/retry/etc. until provider dispose, suppressing the "you have a busy session"
    // warning for the new current session.
    const match = source.match(/pruneDeletedSession\(sessionID: string\): void \{([\s\S]*?)\n  \}/)
    expect(match).not.toBeNull()
    expect(match![1]).toContain("this.removedSessionIds.add(sessionID)")
    expect(match![1]).toContain("this.sessionStatusMap.delete(sessionID)")
    expect(source).toContain("if (this.removedSessionIds.has(sid)) return")
  })

  it("clears currentSession and contextSessionID when the deleted id matches", () => {
    // The SSE session.deleted path runs pruneDeletedSession; if it leaves
    // currentSession pointing at the deleted session, resolveSession() in the
    // next sendMessage falls back to currentSession.id and targets a session
    // the backend has already deleted. The user-initiated delete path
    // (handleDeleteSession) does this clearing after the prune; pruneDeletedSession
    // itself must do the same so the SSE path is symmetric.
    const match = source.match(/pruneDeletedSession\(sessionID: string\): void \{([\s\S]*?)\n  \}/)
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(
      /if \(this\.currentSession\?\.id === sessionID\)\s*\{[\s\S]*?this\.contextSessionID = undefined[\s\S]*?this\.setCurrentSession\(null\)/,
    )
  })

  it("unfocuses the streams when the deleted id matches the focused session", () => {
    // Without this, connectionService still reports the deleted id to the
    // backend as visible, and focusSession() never clears the visible
    // registration for this instance.
    const match = source.match(/pruneDeletedSession\(sessionID: string\): void \{([\s\S]*?)\n  \}/)
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(/if \(this\.streams\.focused === sessionID\) this\.focusSession\(undefined\)/)
  })
})

describe("sendMessage / sendCommand draft id contract", () => {
  const source = readFile(SESSION_FILE)

  it("sendMessage mints a draftID when there is no current session and none was supplied", () => {
    // External session deletions leave currentSessionID() undefined and clear
    // draftSessionID(). Without minting a draftID here, the webview posts
    // {type: "sendMessage", sessionID: undefined, draftID: undefined} and the
    // extension's sessionCreated echo has no key to migrate the in-flight draft
    // from ":pending:<id>" to ":session:<newSessionId>". The user loses the
    // typed message and the new session starts empty.
    const body = extractFunctionBody(source, "sendMessage")
    expect(body).toMatch(/const effectiveDraftID = !sid && !draftID \? crypto\.randomUUID\(\) : draftID/)
  })

  it("sendCommand mints a draftID when there is no current session and none was supplied", () => {
    const body = extractFunctionBody(source, "sendCommand")
    expect(body).toMatch(/const effectiveDraftID = !sid && !draftID \? crypto\.randomUUID\(\) : draftID/)
  })

  it("sendMessage seeds the pending agent before resolving the draft-scoped agent", () => {
    // Fresh draft IDs are created after ModeSwitcher stored the selected mode in
    // pendingAgentSelection(). The draft scope must inherit that pending agent
    // before promptAgent(scope) runs, otherwise the first send pairs the selected
    // model with the default agent's system prompt.
    const body = extractFunctionBody(source, "sendMessage")
    expect(body).toMatch(
      /if \(!sid && !draftID && effectiveDraftID\) agentDrafts\.seed\(effectiveDraftID\)[\s\S]*const agent = promptAgent\(scope\)/,
    )
  })

  it("sendCommand seeds the pending agent before resolving the draft-scoped agent", () => {
    const body = extractFunctionBody(source, "sendCommand")
    expect(body).toMatch(
      /if \(!sid && !draftID && effectiveDraftID\) agentDrafts\.seed\(effectiveDraftID\)[\s\S]*const agent = promptAgent\(scope\)/,
    )
  })

  it("sendMessage and sendCommand post the agent returned by promptAgent", () => {
    expect(extractFunctionBody(source, "sendMessage")).toContain("const agent = promptAgent(scope)")
    expect(extractFunctionBody(source, "sendCommand")).toContain("const agent = promptAgent(scope)")
    expect(extractFunctionBody(source, "promptAgent")).toContain("return resolvePromptAgent({")
  })

  it("createSession and clearCurrentSession do not pin the provisional default agent", () => {
    expect(extractFunctionBody(source, "createSession")).toContain("setPendingAgentSelection(null)")
    expect(extractFunctionBody(source, "createSession")).not.toContain("setPendingAgentSelection(defaultAgent())")
    expect(extractFunctionBody(source, "clearCurrentSession")).toContain("setPendingAgentSelection(null)")
    expect(extractFunctionBody(source, "clearCurrentSession")).not.toContain("setPendingAgentSelection(defaultAgent())")
  })

  it("does not clear a newer pending agent when a seeded draft is promoted", () => {
    const body = extractFunctionBody(source, "handleSessionCreated")
    const draftBlock = body.match(/if \(draftID\) \{([\s\S]*?)\} else if/)
    expect(draftBlock).not.toBeNull()
    expect(draftBlock![1]).not.toContain("setPendingAgentSelection(null)")
  })

  it("only selects a created session when its explicit draft is still active", () => {
    const body = extractFunctionBody(source, "handleSessionCreated")
    expect(body).toMatch(/if \(draftID && \(draft === draftID \|\| active === draftID\)\)/)
    expect(body).not.toMatch(/if \(!draftID \|\|/)
  })

  it("prunes seeded draft agents only after the draft is abandoned", () => {
    const failed = extractFunctionBody(source, "handleSendMessageFailed")
    expect(source).toMatch(/const agentDrafts = createDraftAgentSeed/)
    expect(source).toContain("active: (draft) => !!submissionMap[draft]")
    expect(failed).toContain("draftSessionID() !== message.draftID")
    expect(failed).toContain("agentDrafts.prune(message.draftID)")
    expect(failed).not.toContain("setDraftSessionID(message.draftID)")
  })
})

describe("PromptInput restoreFailed fallback contract", () => {
  const source = readFile(PROMPT_FILE)

  it("stores a failed payload under its originating session or pending draft key", () => {
    const match = source.match(/const restoreFailed = \(failed: SendMessageFailedMessage\) => \{([\s\S]*?)\n  \}/)
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(
      /failed\.sessionID\s*\? scopeDraftKey\(boxKey\(\), sessionDraftKey\(failed\.sessionID\)\)/,
    )
    expect(match![1]).toMatch(/failed\.draftID\s*\? scopeDraftKey\(boxKey\(\), pendingDraftKey\(failed\.draftID\)\)/)
    expect(match![1]).toContain("if (target !== draftKey())")
    expect(match![1]).toContain("saveDraft(target, draft, comments, images")
  })

  it("does not restore a late failure for a discarded pending tab", () => {
    const match = source.match(/const restoreFailed = \(failed: SendMessageFailedMessage\) => \{([\s\S]*?)\n  \}/)
    expect(match).not.toBeNull()
    expect(match![1]).toContain("isPendingDraftDiscarded(failed.draftID)")
    expect(match![1]).toContain("isSessionDraftDiscarded(failed.sessionID)")
  })

  it("retires a discarded real-session marker only after confirmed assistant output", () => {
    const session = readFile(SESSION_FILE)
    const created = extractFunctionBody(session, "handleMessageCreated")
    const status = extractFunctionBody(session, "handleSessionStatus")
    expect(created).toContain('message.role === "assistant"')
    expect(created).toContain("clearSessionDraftDiscarded(message.sessionID)")
    expect(status).not.toContain("clearSessionDraftDiscarded")
  })
})

describe("PromptInput send origin contract", () => {
  const source = readFile(PROMPT_FILE)

  it("captures the real or pending tab before asynchronous attachment resolution", () => {
    expect(source).toMatch(/const origin = session\.currentSessionID\(\)[\s\S]*const id = origin \?\? pendingId/)
    expect(source.indexOf("beginPending(pendingId)")).toBeLessThan(
      source.indexOf("const terminalFile = await terminal"),
    )
    expect(source).toMatch(/resolveAttachment\(message, id, readTerminalContext\(props\.terminalContext\)\)/)
    expect(source).toMatch(/await git\.resolveAttachment\(message, id, context\)/)
  })

  it("passes the captured origin to message and command sends", () => {
    expect(source).toMatch(/session\.sendMessage\([\s\S]*origin \?\? null\)/)
    expect(source).toMatch(/session\.sendCommand\([\s\S]*origin \?\? null\)/)
  })

  it("records sent prompts before a pending session key change can return", () => {
    const start = source.indexOf("const handleSend = async () =>")
    const end = source.indexOf("\n  return (", start)
    const body = source.slice(start, end)
    const send = Math.max(body.indexOf("session.sendMessage("), body.indexOf("session.sendCommand("))
    const append = body.lastIndexOf("history.append(draft)")
    const guard = body.indexOf("if (draftKey() !== key) return")

    expect(send).toBeGreaterThan(-1)
    expect(append).toBeGreaterThan(send)
    expect(append).toBeLessThan(guard)
    expect(body.indexOf('setText("")', guard)).toBeGreaterThan(guard)
  })
})

describe("SessionContext userClearedSession contract", () => {
  const source = readFile(SESSION_FILE)

  it("declares userClearedSession on the context interface", () => {
    // restoreFailed uses session.userClearedSession() to decide whether :new
    // is a legitimate restore target after the user clicks New Task or
    // deletes their current/draft session. The accessor must be exposed.
    expect(readFile(SESSION_TYPES_FILE)).toMatch(/userClearedSession:\s*Accessor<boolean>/)
  })

  it("clearCurrentSession sets the flag", () => {
    // User clicking New Task while a failure is pending must NOT restore
    // the failed draft into the new prompt.
    const body = extractFunctionBody(source, "clearCurrentSession")
    expect(body).toMatch(/setUserClearedSession\(true\)/)
  })

  it("deleteSession sets the flag when deleting the current or draft session", () => {
    // User clicking Delete on their current/draft session is morally the
    // same as New Task — both land in :new without wanting a stale restore.
    const body = extractFunctionBody(source, "deleteSession")
    expect(body).toMatch(
      /if \(id === currentSessionID\(\) \|\| id === draftSessionID\(\)\) setUserClearedSession\(true\)/,
    )
  })

  it("handleSessionCreated resets the flag when adopting the new session", () => {
    // After the user creates a new session, the flag is stale and must be
    // cleared so a later external delete of that new session can restore
    // into :new again.
    const body = extractFunctionBody(source, "handleSessionCreated")
    expect(body).toMatch(/setUserClearedSession\(false\)/)
  })

  it("selectSession resets the flag when picking an existing session", () => {
    const body = extractFunctionBody(source, "selectSession")
    expect(body).toMatch(/setUserClearedSession\(false\)/)
  })

  it("exposes userClearedSession in the SessionContext value", () => {
    expect(source).toMatch(/userClearedSession,?\s*\n\s*\}/m)
  })

  it("sendMessage resets userClearedSession when starting a fresh draft from :new", () => {
    // Race: user on session A, sends, failure pending; clicks New Task
    // (userClearedSession=true), then types new text and clicks Send. We mint
    // a draftID and adopt it as draftSessionID. If a failure for the new
    // send returns BEFORE sessionCreated lands (so currentSessionID is
    // still undefined and userClearedSession is still true), the failure's
    // draftID matches draftSessionID() but the flag would suppress restore.
    // Resetting the flag at the moment the user starts the new draft closes
    // that window: the failure is for the current in-progress draft and must
    // be restorable.
    const body = extractFunctionBody(source, "sendMessage")
    const block = body.match(/if \(!sid && \(!draftID \|\| draftSessionID\(\) === scope\)\) \{([\s\S]*?)\}/)
    expect(block).not.toBeNull()
    expect(block![1]).toMatch(/setUserClearedSession\(false\)/)
    expect(block![1]).toMatch(/setDraftSessionID\(scope\)/)
  })

  it("sendCommand resets userClearedSession when starting a fresh draft from :new", () => {
    const body = extractFunctionBody(source, "sendCommand")
    const block = body.match(/if \(!sid && \(!draftID \|\| draftSessionID\(\) === scope\)\) \{([\s\S]*?)\}/)
    expect(block).not.toBeNull()
    expect(block![1]).toMatch(/setUserClearedSession\(false\)/)
    expect(block![1]).toMatch(/setDraftSessionID\(scope\)/)
  })
})

describe("Optimistic parts preservation and smooth status contract", () => {
  const source = readFile(SESSION_FILE)

  it("handleMessageCreated preserves optimistic parts instead of deleting them", () => {
    const created = extractFunctionBody(source, "handleMessageCreated")
    expect(created).not.toMatch(/delete\s+p\[message\.id\]/)
    expect(created).toContain("pendingOptimistic.get(message.sessionID)")
  })

  it("handlePartUpdated replaces matching optimistic parts in place", () => {
    const updated = extractFunctionBody(source, "handlePartUpdated")
    expect(updated).toContain("optimisticParts.get(effectiveMessageID)")
    expect(updated).toContain("mergeOptimisticPart")
  })

  it("statusText derives status from the active turn instead of queued follow-ups", () => {
    const match = source.match(/const statusText = createMemo<string \| undefined>\(\(\) => \{([\s\S]*?)\n  \}\)/)
    expect(match).not.toBeNull()
    expect(match![1]).toContain("activeUserMessageID(msgs, statusInfo()")
    expect(match![1]).toContain('language.t("ui.sessionTurn.status.thinking")')
  })
})

describe("KiloConnectionService pruneSession contract", () => {
  const source = readFile(CONNECTION_SERVICE_FILE)

  it("drops the deleted session from attached and visible Maps", () => {
    // KiloProvider's pruneDeletedSession calls connectionService.pruneSession.
    // Without clearing attached/visible entries whose value is the deleted id,
    // the backend keeps receiving the dead session id and any background tab
    // opener stays registered for it.
    const match = source.match(/pruneSession\(sessionId: string\): void \{([\s\S]*?)\n  \}/)
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(/this\.attached\.(?:set|delete)/)
    expect(match![1]).toMatch(/this\.visible\.(?:set|delete)/)
    expect(match![1]).toMatch(/this\.flushViewed\(\)/)
  })
})
