# Changelog

## [3.3.3] - 2026-02-15

### Added

- **Selected project highlight in sidebar**: The project in the left sidebar now shows a hover-like highlight when its corresponding tab is selected at the top

## [3.3.2] - 2026-02-15

### Added

- **Focused terminal highlight in sidebar**: The terminal sub-item in the left panel now highlights when it corresponds to the currently focused session, with accent-colored icon and bold name

## [3.3.1] - 2026-02-15

### Fixed

- **Sandbox disabled**: Changed `sandbox: true` to `sandbox: false` in BrowserWindow webPreferences to prevent restricted terminal behavior
- **Git panel state leak**: `activateGroup()` now clears `gitPanelProject` state when switching to a terminal tab, fixing broken tab rendering after using the git panel
- **Fit deduplication bug**: Replaced single `pendingFitGroupId` string with a Set, allowing multiple groups to have pending fit operations simultaneously without dropping fits
- **Silent terminal creation failures**: Added error handling for `openStandaloneTerminal()` calls to log failures instead of silently swallowing them

## [3.3.0] - 2026-02-14

### Fixed

- **Empty state persistence**: The "No projects yet" message now properly hides after creating the first project
- **Cmd+K clear terminal**: Cmd+K now correctly clears the terminal scrollback buffer
- **Shortcut popup on Cmd hold**: Removed the behavior where holding Cmd/Ctrl would show the shortcuts popup — it now only appears when the Shortcuts button is clicked

## [3.2.0] - 2026-02-14

### Fixed — Performance & Memory Leaks

- **PTY process leak**: Closed terminals now get a SIGKILL fallback after 2 seconds if SIGHUP doesn't terminate the process, preventing orphaned shell/child processes
- **PTY event listener leak**: `onData`/`onExit` listeners are now tracked as disposables and explicitly disposed on close, preventing callbacks from firing on dead PTYs
- **Output buffer unbounded growth**: Added 5 MB cap per PTY output buffer to prevent memory exhaustion when the renderer is busy or frozen
- **Flush timer runs forever**: The 16ms output flush interval now starts lazily when the first PTY is created and stops automatically when all PTYs are closed, eliminating idle CPU usage
- **Notification state leak**: `notifiedSessionIds` entries are now cleaned up when sessions are removed via `removeSession()` and `closeGroup()`, preventing unbounded Set growth
- **Stale project state leak**: `expandedProjectNames` and `runningTerminalNames` are now pruned of removed projects on each sidebar render
- **Terminal scrollback unbounded**: Added `scrollback: 5000` limit to xterm.js instances to cap per-terminal memory usage
- **Window state disk thrashing**: `saveWindowState()` is now debounced (500ms) for resize/move events, preventing dozens of synchronous disk writes per second during window resize
- **Dynamic import overhead**: Replaced `await import('./state')` in `updateActiveProjects()` with a static import, removing unnecessary async overhead on every project change
- **Redundant tab renders**: `closeGroup()` no longer calls `renderTerminalTabs()` twice when switching to the next available group
- **O(n\*m) sidebar filtering**: Session lookups in `renderSidebar()` now use a pre-built per-project index instead of scanning all sessions for every project
- **Duplicate RAF calls**: `fitGroupSessions()` now deduplicates `requestAnimationFrame` callbacks to prevent queuing multiple layout passes
- **Init command timer leak**: Pending initial command `setTimeout` is now cleared when a PTY exits before the timer fires

## [3.1.0] - 2026-02-14

### Added

- **Keyboard navigation**: Cmd+Up/Down to cycle through projects, Cmd+Left/Right to cycle through tabs
- **Shortcut popup**: Hold Cmd to see all available keyboard shortcuts. Also accessible via the "Shortcuts" button in the sidebar bottom bar
- **Tab drag-and-drop**: Reorder terminal tabs by dragging them left/right in the tab bar
- **Shortcuts button**: Keyboard icon in the sidebar to open the shortcuts reference panel

### Fixed

- **Project button hover/focus**: Removed persistent focus ring on sidebar action buttons (Git, New Terminal, Split, Edit, Remove) that made them look focused when only hovered
- **Shift+Enter in terminal**: Now correctly inserts a literal newline in the shell (bash/zsh) instead of executing the command. Uses Ctrl+V quoted-insert under the hood

## [3.0.0] - Initial release

- Project manager with integrated terminal (node-pty + xterm.js)
- Sidebar with project list, drag-and-drop reordering
- Terminal tabs with split panes
- Git status panel with inline diffs
- Command palette (Cmd+P)
- Per-project and per-terminal color coding
- macOS native look and feel
