// @chitragupta/ui — Terminal UI Framework

// ─── ANSI Utilities ─────────────────────────────────────────────────────────
export {
	reset,
	fg,
	bg,
	rgb,
	bgRgb,
	bold,
	dim,
	italic,
	underline,
	strikethrough,
	red,
	green,
	yellow,
	blue,
	magenta,
	cyan,
	white,
	gray,
	stripAnsi,
	visibleLength,
	cursorUp,
	cursorDown,
	cursorForward,
	cursorBack,
	cursorTo,
	saveCursor,
	restoreCursor,
	clearScreen,
	clearLine,
	clearDown,
	hideCursor,
	showCursor,
	alternateScreen,
	mainScreen,
} from "./ansi.js";

// ─── Key Handling ───────────────────────────────────────────────────────────
export type { KeyEvent } from "./keys.js";
export { parseKeypress, matchKey } from "./keys.js";

// ─── Input ──────────────────────────────────────────────────────────────────
export { InputHandler } from "./input.js";

// ─── Screen ─────────────────────────────────────────────────────────────────
export { Screen } from "./screen.js";

// ─── Theme ──────────────────────────────────────────────────────────────────
export type { Theme } from "./theme.js";
export { DEFAULT_THEME, MINIMAL_THEME, CHITRAGUPTA_THEME, getTheme, registerTheme, hexToAnsi, hexToBgAnsi } from "./theme.js";

// ─── Components ─────────────────────────────────────────────────────────────
export { Spinner } from "./components/spinner.js";
export { renderMarkdown, detectLanguage } from "./components/markdown.js";
export { Editor } from "./components/editor.js";
export type { Position, CompletionProvider, CompletionItem, PromptMode, EditorStats } from "./components/editor.js";
export { SelectList } from "./components/select-list.js";
export type { SelectItem } from "./components/select-list.js";
export { StatusBar } from "./components/status-bar.js";
export type { StatusBarData, StatusBarSection, StatusBarItem, ProviderHealth } from "./components/status-bar.js";
export { MessageList } from "./components/message-list.js";
export type { MessageMeta } from "./components/message-list.js";
export { Overlay, SelectListOverlay, HelpOverlay } from "./components/overlay.js";
export type { Component, OverlayPanel, SelectListItem } from "./components/overlay.js";
export { box, horizontalLayout, center, truncate, padRight, padLeft } from "./components/box.js";
export type { BoxOptions } from "./components/box.js";

// ─── New Components ─────────────────────────────────────────────────────────
export { SessionTree } from "./components/session-tree.js";
export type { SessionTreeNode } from "./components/session-tree.js";
export { renderDiff, renderUnifiedDiff } from "./components/diff-viewer.js";
export type { DiffFormat, DiffOptions, DiffLine } from "./components/diff-viewer.js";
export { ToastManager } from "./components/toast.js";
export type { ToastType, ToastOptions } from "./components/toast.js";
export { ProgressBar, MultiProgress } from "./components/progress.js";
export type { ProgressBarOptions } from "./components/progress.js";
export { Breadcrumb } from "./components/breadcrumb.js";
export type { BreadcrumbItem } from "./components/breadcrumb.js";
export { HeartbeatMonitor } from "./components/heartbeat-monitor.js";
export type { HeartbeatEntry, HeartbeatMonitorConfig } from "./components/heartbeat-monitor.js";

// ─── Tool Formatter ─────────────────────────────────────────────────────────
export { formatToolFooter, formatBytes, estimateTokens, formatTokens } from "./tool-formatter.js";
export type { ToolFooterOpts } from "./tool-formatter.js";
