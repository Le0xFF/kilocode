import { type Component, createSignal, createMemo, createEffect, on, onCleanup, Show, type JSXElement } from "solid-js"
// Styles are imported by the component so every consumer (sidebar diff viewer,
// agent manager, storybook) picks them up automatically. Keep these imports here —
// see tests/unit/diff-viewer-css-arch.test.ts for the invariant.
import "../agent-manager/agent-manager.css"
import "../agent-manager/agent-manager-review.css"
import "../agent-manager/pr/pr-panel.css"
import "./remote-comments.css"
import { Accordion } from "@kilocode/kilo-ui/accordion"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { ResizeHandle } from "@kilocode/kilo-ui/resize-handle"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../src/context/language"

import { useVSCode } from "../src/context/vscode"
import { useServer } from "../src/context/server"
import { useProvider } from "../src/context/provider"
import { useConfig } from "../src/context/config"

import { FileTree } from "./FileTree"

import { treeOrder } from "./file-tree-utils"
import { getDirectory, getFilename, lineCount, sanitizeReviewComments, type ReviewComment } from "./review-comments"
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
} from "./review-annotations"

import {
  LONG_DIFF_MARKER_FILE_COUNT,
  allOpenFiles,
  isDiffExpandable,
  isLargeDiffFile,
  sanitizeOpenFiles,
  toggleOpenFiles,
} from "./diff-open-policy"
import { DiffEndMarker } from "./DiffEndMarker"
import { VirtualDiffList } from "./VirtualDiffList"
import { createDiffViewport } from "./diff-requests"
import { RemoteCommentsOutside } from "./remote-comment-renderer"
import { ReviewDiffItem } from "./ReviewDiffItem"
import { createReviewView, type ReviewViewProps } from "./review-controller"
import { notice, reviewSendAllKeybind } from "./review-setup"

type DiffStyle = "unified" | "split"

interface FullScreenDiffViewProps extends ReviewViewProps {
  loading: boolean
  sessionId?: string
  /** Well-known source notice kind (e.g. "snapshots-disabled"), shown as a banner. */
  notice?: string
  diffStyle: DiffStyle
  onDiffStyleChange: (style: DiffStyle) => void
  onMarkdownRenderChange?: (render: boolean) => void
  initialFile?: string
  onRevertFile?: (file: string) => void
  revertingFiles?: Set<string>
  /** Defaults to true. Hides the per-file Revert action when false. */
  canRevert?: boolean
  /** Optional leading content rendered first in the toolbar's left group. */
  lead?: JSXElement
  onClose: () => void
}

export const FullScreenDiffView: Component<FullScreenDiffViewProps> = (props) => {
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
  const noticeText = () => notice(t, props.notice)
  const sendAllKeybind = () => reviewSendAllKeybind(t)
  let rootRef: HTMLDivElement | undefined
  const {
    open,
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


  const [manualActiveFile, setManualActiveFile] = createSignal<Record<string, string | null>>({})
  const activeFile = createMemo(() => {
    const key = props.sessionKey ?? ""
    const diffs = props.diffs
    if (diffs.length === 0) return null
    const manual = manualActiveFile()[key]
    if (manual && diffs.some((d) => d.file === manual)) return manual
    return diffs[0]?.file ?? null
  })
  const setActiveFile = (file: string | null) => {
    const key = props.sessionKey ?? ""
    setManualActiveFile((prev) => ({ ...prev, [key]: file }))
  }


  const [draft, setDraft] = createSignal<ReviewDraft | null>(reviewComposerDraft(composer()))
  const [editing, setEditing] = createSignal<string | null>(reviewComposerEdit(composer()))

  const [treeWidth, setTreeWidth] = createSignal(240)
  let initialFileKey: string | undefined
  let syncFrame: number | undefined

  createEffect(
    on(
      () => [props.sessionKey, props.diffs, props.initialFile] as const,
      ([key, diffs, initial]) => {
        if (!initial || !diffs.some((diff) => diff.file === initial)) return
        const next = `${key ?? ""}:${initial}`
        if (initialFileKey === next) return
        initialFileKey = next
        setActiveFile(initial)
      },
    ),
  )

  createEffect(
    on(
      () => props.sessionKey,
      () => {
        setDraft(null)
        draftMeta = null
        setEditing(null)
        editMeta = null
        clearReviewComposer(composer())
      },
      { defer: true },
    ),
  )

  const request = createDiffRequests({
    key: () => props.sessionKey,
    diffs: () => props.diffs,
    open,
    loading: () => props.loadingFiles,
    send: () => props.onRequestDiff,
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

  const handleRootMouseDown = (e: MouseEvent) => {
    if (keepNativeFocus(e.target)) return
    focusRoot()
  }

  createEffect(
    on(
      () => [props.diffs, comments()] as const,
      ([diffs, current]) => {
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
    composer().draft = draft() ? draftMeta : null
    composer().edit = editing() ? editMeta : null
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

  const handleGutterClick = (file: string, range: SelectedLineRange) => {
    if (props.canComment === false) return
    if (draft()) return
    const side: AnnotationSide = range.side === "deletions" ? "deletions" : "additions"
    preserveScroll(() => {
      const next = { file, side, line: range.start, endLine: range.end }
      draftMeta = { type: "draft", comment: null, ...next }
      composer().draft = draftMeta
      setDraft(next)
    })
  }

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
    if (props.canComment === false) return
    if (comments().length === 0) return
    e.preventDefault()
    e.stopPropagation()
    sendAllToChat()
  }


  const handleFileSelect = (path: string) => {
    const diff = props.diffs.find((item) => item.file === path)
    if (diff) request(diff)
    setActiveFile(path)
    if (diff && isDiffExpandable(diff) && !open().includes(path)) setOpen((prev) => [...prev, path])
    requestAnimationFrame(() => {
      const index = rows().findIndex((diff) => diff.file === path)
      if (index < 0) return
      const handle = virtualizer()
      const current = handle?.findItemIndex(handle.scrollOffset) ?? index
      virtualizer()?.scrollToIndex(index, { offset: -8, smooth: Math.abs(index - current) <= 8 })
    })
  }

  const handleExpandAll = () => {
    setOpen(toggleOpenFiles(props.diffs, open()))
  }

  const syncActiveFileFromScroll = () => {
    const handle = virtualizer()
    if (!handle) return
    const file = rows()[handle.findItemIndex(handle.scrollOffset)]?.file
    if (file) setActiveFile(file)
  }

  const scheduleSyncActiveFile = () => {
    if (syncFrame !== undefined) cancelAnimationFrame(syncFrame)
    syncFrame = requestAnimationFrame(() => {
      syncFrame = undefined
      syncActiveFileFromScroll()
    })
  }

  // Keep file tree selection in sync with viewport during scroll in both directions.
  createEffect(() => {
    const container = scroller()
    if (!container) return
    const onScroll = () => scheduleSyncActiveFile()
    const resize = new ResizeObserver(() => scheduleSyncActiveFile())
    container.addEventListener("scroll", onScroll, { passive: true })
    resize.observe(container)
    scheduleSyncActiveFile()

    onCleanup(() => {
      container.removeEventListener("scroll", onScroll)
      resize.disconnect()
      if (syncFrame !== undefined) {
        cancelAnimationFrame(syncFrame)
        syncFrame = undefined
      }
    })
  })

  createEffect(
    on(
      () => [props.diffs, open()] as const,
      () => scheduleSyncActiveFile(),
    ),
  )

  const totals = createMemo(() => ({
    files: props.diffs.length,
    additions: props.diffs.reduce((s, d) => s + d.additions, 0),
    deletions: props.diffs.reduce((s, d) => s + d.deletions, 0),
    large: props.diffs.filter((diff) => isDiffExpandable(diff) && isLargeDiffFile(diff)).length,
    collapsed: props.diffs.filter((diff) => isDiffExpandable(diff) && !open().includes(diff.file)).length,
  }))
  const allOpen = createMemo(() => allOpenFiles(props.diffs, open()))
  const openLabel = () => (allOpen() ? t("ui.sessionReview.collapseAll") : t("ui.sessionReview.expandAll"))

  return (
    <div
      class="am-review-layout"
      onKeyDown={handleKeyDown}
      onMouseDown={handleRootMouseDown}
      tabIndex={-1}
      ref={rootRef}
    >
      {/* Toolbar */}
      <div class="am-review-toolbar">
        <div class="am-review-toolbar-left">
          <Show when={props.lead}>{props.lead}</Show>
          <RadioGroup
            options={["unified", "split"] as const}
            current={props.diffStyle}
            size="small"
            value={(style) => style}
            label={(style) =>
              style === "unified" ? t("ui.sessionReview.diffStyle.unified") : t("ui.sessionReview.diffStyle.split")
            }
            onSelect={(style) => {
              if (style) props.onDiffStyleChange(style)
            }}
          />
          <span class="am-review-toolbar-stats">
            <span>{t("session.review.filesChanged", { count: totals().files })}</span>
            <span class="am-review-toolbar-adds">+{totals().additions}</span>
            <span class="am-review-toolbar-dels">-{totals().deletions}</span>
            <Show when={totals().collapsed > 0}>
              <span class="am-review-toolbar-collapsed">
                {totals().large > 0
                  ? t("agentManager.review.collapsedWithLarge", {
                      collapsed: totals().collapsed,
                      large: totals().large,
                    })
                  : t("agentManager.review.collapsedOnly", { count: totals().collapsed })}
              </span>
            </Show>
          </span>
        </div>
        <div class="am-review-toolbar-right">
          <Button size="small" variant="ghost" onClick={handleExpandAll}>
            <Icon name="chevron-grabber-vertical" size="small" />
            {openLabel()}
          </Button>
          <Show when={comments().length > 0 && props.canComment !== false}>
            <TooltipKeybind
              title={t("agentManager.review.sendAllToChat")}
              keybind={sendAllKeybind()}
              placement="bottom"
            >
              <Button variant="primary" size="small" onClick={sendAllClick}>
                {t("agentManager.review.sendAllToChatWithCount", { count: comments().length })}
              </Button>
            </TooltipKeybind>
          </Show>
          <IconButton icon="close" size="small" variant="ghost" label={t("common.close")} onClick={props.onClose} />
        </div>
      </div>

      {/* Body: file tree + diff viewer */}
      <div class="am-review-body">
        <div class="am-review-tree-resize" style={{ width: `${treeWidth()}px` }}>
          <div class="am-review-tree-wrapper">
            <FileTree
              diffs={props.diffs}
              activeFile={activeFile()}
              onFileSelect={handleFileSelect}
              comments={comments()}
              onRevertFile={props.canRevert !== false ? props.onRevertFile : undefined}
              revertingFiles={props.revertingFiles}
            />
          </div>
          <ResizeHandle
            direction="horizontal"
            edge="end"
            size={treeWidth()}
            min={160}
            max={400}
            onResize={(w) => setTreeWidth(Math.max(160, Math.min(w, 400)))}
          />
        </div>
        <div class="am-review-diff" ref={setScroller}>
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
              <Spinner />
              <span>{t("session.review.loadingChanges")}</span>
            </div>
          </Show>

          <Show when={!props.loading && props.diffs.length === 0 && !noticeText()}>
            <div class="am-diff-empty">
              <span>{t("session.review.noChanges")}</span>
            </div>
          </Show>

          <Show when={props.diffs.length > 0}>
            <div class="am-review-diff-content" data-component="session-review">
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
                        loading={() => props.loadingFiles?.has(diff.file) ?? false}
                        comments={() => (commentsByFile().get(diff.file) ?? []).length + remote.fileCount(diff.file)}
                        diffStyle={() => props.diffStyle}
                        markdownRender={() => props.markdownRender ?? false}
                        handle={(handle) => register(diff.file, handle)}
                        scrollTo={(offset) => virtualizer()?.scrollTo(offset)}
                        annotations={() => [...review.annotationsForFile(diff.file), ...annotations()]}
                        renderAnnotation={render}
                        onGutterUtilityClick={(result) => handleGutterClick(diff.file, result)}
                        onOpenFile={props.onOpenFile}
                        onRevertFile={props.canRevert !== false ? props.onRevertFile : undefined}
                        reverting={() => props.revertingFiles?.has(diff.file) ?? false}
                        onMarkdownRenderChange={props.onMarkdownRenderChange}
                        canComment={() => props.canComment !== false}
                        sessionKey={props.sessionKey}
                        showLoadingSpinner
                      />
                    )
                  }}
                />
              </Accordion>
              <Show when={props.diffs.length > LONG_DIFF_MARKER_FILE_COUNT}>
                <DiffEndMarker />
              </Show>
            </div>
          </Show>
          <RemoteCommentsOutside controller={remote} />
        </div>
      </div>
    </div>
  )
}
