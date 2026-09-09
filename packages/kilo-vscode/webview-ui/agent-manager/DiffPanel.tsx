import { type Component, createMemo, Show, type JSXElement } from "solid-js"
import { Accordion } from "@kilocode/kilo-ui/accordion"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip, TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../src/context/language"
import { DiffStyleSelect } from "../diff-viewer/InlineSelect"

import { useVSCode } from "../src/context/vscode"
import { useServer } from "../src/context/server"
import { useProvider } from "../src/context/provider"
import { useConfig } from "../src/context/config"
import {
  getDirectory,
  getFilename,
  lineCount,
  sanitizeReviewComments,
  type ReviewComment,
} from "../diff-viewer/review-comments"
import {
  buildFileAnnotations,
  buildReviewAnnotation,
  clearReviewComposer,
  createReviewComposer,
  reviewComposerDraft,
  reviewComposerEdit,
  sendReviewComments,
  labels,
  type AnnotationMeta,
  type ReviewComposer,
  type ReviewDraft,
} from "../diff-viewer/review-annotations"

import {
  LONG_DIFF_MARKER_FILE_COUNT,
  allOpenFiles,
  isDiffExpandable,
  isLargeDiffFile,
  sanitizeOpenFiles,
  toggleOpenFiles,
} from "../diff-viewer/diff-open-policy"
import { DiffEndMarker } from "../diff-viewer/DiffEndMarker"
import { VirtualDiffList } from "../diff-viewer/VirtualDiffList"
import { createDiffViewport } from "../diff-viewer/diff-requests"
import "./pr/pr-panel.css"
import "../diff-viewer/remote-comments.css"
import { RemoteCommentsOutside } from "../diff-viewer/remote-comment-renderer"
import { ReviewDiffItem } from "../diff-viewer/ReviewDiffItem"
import { createReviewView, type ReviewViewProps } from "../diff-viewer/review-controller"
import { notice, reviewSendAllKeybind } from "../diff-viewer/review-setup"

// --- Data model ---

interface DiffPanelProps extends ReviewViewProps {
  loading: boolean
  sessionId?: string
  /** Well-known source notice kind (e.g. "snapshots-disabled"), shown as a banner. */
  notice?: string
  diffStyle?: "unified" | "split"
  onDiffStyleChange?: (style: "unified" | "split") => void
  onMarkdownRenderChange?: (render: boolean) => void
  onClose: () => void
  onExpand?: () => void
  onOpenDocument?: (relativePath: string) => void
  onRevertFile?: (file: string) => void
  revertingFiles?: Set<string>
  /** Optional leading row rendered under the header (e.g. the scope selector). */
  lead?: JSXElement
  /** Defaults to true. Hides the per-file Revert action when false. */
  canRevert?: boolean
}

export const DiffPanel: Component<DiffPanelProps> = (props) => {
  const { t } = useLanguage()

  const noticeText = () => {
    const n = props.notice
    if (!n) return ""
    return t(DIFF_NOTICE_KEYS[n] ?? n)
  }
  const vscode = useVSCode()
  const server = useServer()
  const provider = useProvider()
  const { config } = useConfig()
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
  const sendAllKeybind = () =>
    isMac ? t("agentManager.review.sendAllShortcut.mac") : t("agentManager.review.sendAllShortcut.other")
  const localComposer = createReviewComposer()
  const composer = () => props.composer ?? localComposer
  const [manualOpen, setManualOpen] = createSignal<Record<string, string[]>>({})
  const [knownFiles, setKnownFiles] = createSignal<Record<string, string[]>>({})
  const open = createMemo(() => {
    const key = props.sessionKey ?? ""
    const diffs = props.diffs
    if (diffs.length === 0) return []
    const manual = manualOpen()[key]
    if (manual) return sanitizeOpenFiles(diffs, manual)
    return initialOpenFiles(diffs)
  })
  createEffect(
    on(
      () => [props.sessionKey, props.diffs] as const,
      ([key, diffs]) => {
        if (diffs.length === 0) return
        const id = key ?? ""
        const manual = manualOpen()[id]
        const result = reconcileOpenFiles(diffs, manual, knownFiles()[id] ?? [])
        setKnownFiles((prev) => ({ ...prev, [id]: result.known }))
        if (!manual || !result.open) return
        if (result.open.length === manual.length && result.open.every((file, index) => file === manual[index])) return
        setManualOpen((prev) => ({ ...prev, [id]: result.open! }))
      },
    ),
  )

  const setOpen = (files: string[] | ((prev: string[]) => string[])) => {
    const key = props.sessionKey ?? ""
    const current = open()
    const next = typeof files === "function" ? files(current) : files
    setManualOpen((prev) => ({ ...prev, [key]: sanitizeOpenFiles(props.diffs, next) }))
  }
  const [draft, setDraft] = createSignal<ReviewDraft | null>(reviewComposerDraft(composer()))
  const [editing, setEditing] = createSignal<string | null>(reviewComposerEdit(composer()))
  let nextId = 0

  // Reorder diffs to match the file-tree's depth-first visual order so
  // scrolling through the accordion matches the tree grouping.
  const sorted = createMemo(() => treeOrder(props.diffs))
  const rows = createDiffRows(sorted, () => props.sessionKey)

  const comments = () => props.comments
  const setComments = (next: ReviewComment[]) => props.onCommentsChange(next)
  const updateComments = (updater: (prev: ReviewComment[]) => ReviewComment[]) => setComments(updater(comments()))

  // Stable composer metadata refs avoid recreating the object on every signal read
  // so pierre's annotation cache doesn't invalidate and destroy the textarea.
  let draftMeta: AnnotationMeta | null = composer().draft
  let editMeta: AnnotationMeta | null = composer().edit
  createRenderEffect(
    on(
      () => props.active,
      (active) => {
        if (!active) return
        const value = reviewComposerDraft(composer())
        const edit = reviewComposerEdit(composer())
        setDraft(value)
        setEditing(edit)
        draftMeta = composer().draft
        editMeta = composer().edit
      },
    ),
  )

  // Ref to the scrollable container — used to preserve scroll position when
  // annotation changes cause pierre to fully re-render diffs
  const noticeText = () => notice(t, props.notice)
  const sendAllKeybind = () => reviewSendAllKeybind(t)

  let rootRef: HTMLDivElement | undefined
  const {
    open,

    loading: () => props.loadingFiles,
    send: () => (props.active === false ? undefined : props.onRequestDiff),
    eager: false,
  })

  // --- CRUD ---

  const addComment = (file: string, side: AnnotationSide, line: number, text: string, selectedText: string) => {
    preserveScroll(() => {
      const id = `c-${++nextId}-${Date.now()}`
      updateComments((prev) => [...prev, { id, file, side, line, comment: text, selectedText }])
      setDraft(null)
      draftMeta = null
      composer().draft = null
    })
    focusRoot()
  }

  const sendComment = (file: string, side: AnnotationSide, line: number, text: string, selectedText: string) => {
    const comment = { id: `c-${++nextId}-${Date.now()}`, file, side, line, comment: text, selectedText }
    sendReviewComments([comment], props.activeTerminalId)
    preserveScroll(() => {
      setDraft(null)
      draftMeta = null
      composer().draft = null
    })
    props.onSendClick?.()
    focusRoot()
  }

  const updateComment = (id: string, text: string) => {
    preserveScroll(() => {
      updateComments((prev) => prev.map((c) => (c.id === id ? { ...c, comment: text } : c)))
      setEditing(null)
      editMeta = null
      composer().edit = null
    })
    focusRoot()
  }

  const deleteComment = (id: string) => {
    preserveScroll(() => {
      updateComments((prev) => prev.filter((c) => c.id !== id))
      if (editing() === id) {
        setEditing(null)
        editMeta = null
        composer().edit = null
      }
    })
    focusRoot()
  }

  const setEditState = (id: string | null) => {
    if (editing() !== id) {
      editMeta = null
      composer().edit = null
    }
    preserveScroll(() => setEditing(id))
    if (id === null) focusRoot()
  }

  createEffect(
    on(
      () => [props.diffs, comments()] as const,
      ([diffs, current]) => {
        if (props.active === false) return
        const valid = sanitizeReviewComments(current, diffs)
        if (valid.length !== current.length) {
          setComments(valid)
        }

        const edit = editing()
        if (edit && !valid.some((comment) => comment.id === edit)) {
          setEditing(null)
          editMeta = null
          composer().edit = null
        }

        const currentDraft = draft()
        if (!currentDraft) return
        const diff = diffs.find((item) => item.file === currentDraft.file)
        if (!diff) {
          setDraft(null)
          draftMeta = null
          composer().draft = null
          return
        }
        const content = currentDraft.side === "deletions" ? diff.before : diff.after
        const max = lineCount(content)
        if (currentDraft.line < 1 || currentDraft.line > max) {
          setDraft(null)
          draftMeta = null
          composer().draft = null
          return
        }
        if (currentDraft.endLine !== undefined && currentDraft.endLine > max) {
          setDraft(null)
          draftMeta = null
          composer().draft = null
        }
      },
    ),
  )

  // --- Per-file memoized annotations ---

  const commentsByFile = createMemo(() => {
    const map = new Map<string, ReviewComment[]>()
    for (const c of comments()) {
      const arr = map.get(c.file) ?? []
      arr.push(c)
      map.set(c.file, arr)
    }
    return map
  })
  const pinned = createMemo(() => {
    const files = new Set<string>()
    const current = draft()
    if (current) files.add(current.file)
    const edit = editing()
    if (edit) {
      const comment = comments().find((item) => item.id === edit)
      if (comment) files.add(comment.file)
    }
    return rows().flatMap((diff, index) => (files.has(diff.file) ? [index] : []))
  })

  const annotationsForFile = (file: string): DiffLineAnnotation<AnnotationMeta>[] => {
    const result = buildFileAnnotations(file, commentsByFile().get(file) ?? [], editing(), draft(), draftMeta, editMeta)
    draftMeta = result.draftMeta
    editMeta = result.editMeta
    if (untrack(() => props.active) !== false) {
      composer().draft = draft() ? draftMeta : null
      composer().edit = editing() ? editMeta : null
    }
    return result.annotations
  }

  const buildAnnotation = (annotation: DiffLineAnnotation<AnnotationMeta>): HTMLElement | undefined => {
    return buildReviewAnnotation(annotation, {
      diffs: props.diffs,
      editing: editing(),
      setEditing: setEditState,
      addComment,
      sendComment,
      updateComment,
      deleteComment,
      cancelDraft,
      labels: labels(t),
      activeTerminalId: props.activeTerminalId,
    })
  }

  const handleRootMouseDown = (e: MouseEvent) => {
    if (keepNativeFocus(e.target)) return
    focusRoot()
  }

  // --- Gutter utility click ---
  const handleGutterClick = (file: string, range: SelectedLineRange) => {
    // Don't open a second draft while one is active
    if (draft()) return
    const side: AnnotationSide = range.side === "deletions" ? "deletions" : "additions"
    preserveScroll(() => {
      const next = { file, side, line: range.start, endLine: range.end }
      draftMeta = { type: "draft", comment: null, ...next }
      composer().draft = draftMeta
      setDraft(next)
    })
  }

  // --- Send all ---
  const sendAllToChat = () => {
    const all = comments()
    if (all.length === 0) return
    sendReviewComments(all, props.activeTerminalId)
    preserveScroll(() => setComments([]))
    props.onSendAll?.()
  }

  const sendAllClick = () => {
    props.onSendClick?.()
    sendAllToChat()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return
    if (!(e.metaKey || e.ctrlKey)) return
    const target = e.target
    if (keepNativeFocus(target)) return
    if (comments().length === 0) return
    e.preventDefault()
    e.stopPropagation()
    sendAllToChat()
  }
    setOpen,
    rows,
    remote,
    register,
    scroller,
    setScroller,
    virtualizer,
    setVirtualizer,
    comments,
    review,
    pinned,
    render,
    request,
    handleRootMouseDown,
    handleKeyDown,
    commentsByFile,
    handleGutterClick,
    sendAllClick,
  } = createReviewView(props, () => rootRef)


  const handleExpandAll = () => {
    setOpen(toggleOpenFiles(props.diffs, open()))
  }

  const totals = createMemo(() => ({
    files: props.diffs.length,
    additions: props.diffs.reduce((sum, diff) => sum + diff.additions, 0),
    deletions: props.diffs.reduce((sum, diff) => sum + diff.deletions, 0),
    large: props.diffs.filter((diff) => isDiffExpandable(diff) && isLargeDiffFile(diff)).length,
    collapsed: props.diffs.filter((diff) => isDiffExpandable(diff) && !open().includes(diff.file)).length,
  }))
  const allOpen = createMemo(() => allOpenFiles(props.diffs, open()))
  const openLabel = () => (allOpen() ? t("ui.sessionReview.collapseAll") : t("ui.sessionReview.expandAll"))
  const openIcon = () => (allOpen() ? "files-collapse" : "files-expand")

  return (
    <div class="am-diff-panel" onKeyDown={handleKeyDown} onMouseDown={handleRootMouseDown} tabIndex={-1} ref={rootRef}>
      <div class="am-diff-header">
        <div class="am-diff-header-main">
          {/* Scope + base picker replace the static "Changes" title: it names
              what you're looking at and is the primary control. Always shown,
              so an empty scope can still be switched away from. */}
          <Show when={props.lead}>{props.lead}</Show>
          <Show when={props.diffs.length > 0}>
            <>
              <DiffStyleSelect
                value={props.diffStyle ?? "unified"}
                onSelect={(style) => props.onDiffStyleChange?.(style)}
                unifiedLabel={t("ui.sessionReview.diffStyle.unified")}
                splitLabel={t("ui.sessionReview.diffStyle.split")}
                title={t("ui.sessionReview.diffStyle.unified")}
              />
              <span class="am-diff-header-stats">
                <span>{t("session.review.filesChanged", { count: totals().files })}</span>
                <span class="am-diff-header-adds">+{totals().additions}</span>
                <span class="am-diff-header-dels">-{totals().deletions}</span>
                <Show when={totals().collapsed > 0}>
                  <span class="am-diff-header-collapsed">
                    {totals().large > 0
                      ? t("agentManager.review.collapsedWithLarge", {
                          collapsed: totals().collapsed,
                          large: totals().large,
                        })
                      : t("agentManager.review.collapsedOnly", { count: totals().collapsed })}
                  </span>
                </Show>
              </span>
            </>
          </Show>
        </div>
        <div class="am-diff-header-actions">
          <Show when={props.diffs.length > 0}>
            <Tooltip value={openLabel()} placement="bottom">
              <IconButton
                icon={openIcon()}
                size="small"
                variant="ghost"
                label={openLabel()}
                onClick={handleExpandAll}
              />
            </Tooltip>
          </Show>
          <Show when={props.onExpand}>
            <Tooltip value={t("command.review.toggle")} placement="bottom">
              <IconButton
                icon="expand"
                size="small"
                variant="ghost"
                label={t("command.review.toggle")}
                onClick={() => props.onExpand?.()}
              />
            </Tooltip>
          </Show>
          <IconButton icon="close" size="small" variant="ghost" label={t("common.close")} onClick={props.onClose} />
        </div>
      </div>

      <Show when={noticeText()}>
        <div class="diff-viewer-notice" role="status">
          <span class="diff-viewer-notice-icon">
            <Icon name="warning" size="small" />
          </span>
          <span class="diff-viewer-notice-text">{noticeText()}</span>
        </div>
      </Show>

      <Show when={props.loading && props.diffs.length === 0}>
        <div class="am-diff-loading">
          <span>{t("session.review.loadingChanges")}</span>
        </div>
      </Show>

      <Show when={!props.loading && props.diffs.length === 0 && !noticeText()}>
        <div class="am-diff-empty">
          <span>{t("session.review.noChanges")}</span>
        </div>
      </Show>

      <Show when={props.diffs.length > 0} fallback={<RemoteCommentsOutside controller={remote} />}>
        <div class="am-diff-content" data-component="session-review" ref={setScroller}>
          <Accordion multiple value={open()} onChange={(files) => setOpen(sanitizeOpenFiles(props.diffs, files))}>
            <VirtualDiffList
              context={props.sessionKey}
              data={rows()}
              scroll={scroller()}
              keep={pinned()}
              onReady={setVirtualizer}
              render={(diff) => {
                const viewport = createDiffViewport(scroller)
                const annotations = remote.annotations(diff.file)
                return (
                  <ReviewDiffItem
                    diff={diff}
                    open={open}
                    viewport={viewport}
                    request={props.onRequestDiff ? request : undefined}
                    active={() => props.active !== false}
                    loading={() => props.loadingFiles?.has(diff.file) ?? false}
                    comments={() => (commentsByFile().get(diff.file) ?? []).length + remote.fileCount(diff.file)}
                    diffStyle={() => props.diffStyle ?? "unified"}
                    markdownRender={() => props.markdownRender ?? false}
                    handle={(handle) => register(diff.file, handle)}
                    scrollTo={(offset) => virtualizer()?.scrollTo(offset)}
                    annotations={() => [...review.annotationsForFile(diff.file), ...annotations()]}
                    renderAnnotation={render}
                    onGutterUtilityClick={(result) => handleGutterClick(diff.file, result)}
                    onOpenFile={props.onOpenFile}
                    onOpenDocument={props.onOpenDocument}
                    onRevertFile={props.canRevert !== false ? props.onRevertFile : undefined}
                    reverting={() => props.revertingFiles?.has(diff.file) ?? false}
                    onMarkdownRenderChange={props.onMarkdownRenderChange}
                    canComment={() => true}
                    sessionKey={props.sessionKey}
                    sessionReviewSlot
                  />
                )
              }}
            />
          </Accordion>
          <Show when={props.diffs.length > LONG_DIFF_MARKER_FILE_COUNT}>
            <DiffEndMarker />
          </Show>
          <RemoteCommentsOutside controller={remote} />
        </div>

        <Show when={comments().length > 0}>
          <div class="am-diff-comments-footer">
            <span class="am-diff-comments-count">
              {comments().length} comment{comments().length !== 1 ? "s" : ""}
            </span>
            <TooltipKeybind title={t("agentManager.review.sendAllToChat")} keybind={sendAllKeybind()} placement="top">
              <Button variant="primary" size="small" onClick={sendAllClick}>
                {t("agentManager.review.sendAllToChat")}
              </Button>
            </TooltipKeybind>
          </div>
        </Show>
      </Show>
    </div>
  )
}
