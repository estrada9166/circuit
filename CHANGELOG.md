# Changelog

## [3.6.0] - 2026-04-02

### Added

- **Inline terminal search (⌘F)**: Find text in the terminal buffer with match highlighting and navigation. Shows match count, supports Enter/Shift+Enter to navigate, Escape to close.

### Fixed

- **Command palette runs terminal commands instead of prefilling**: Opening a terminal from the command palette now prefills the command instead of executing it immediately.

## [3.5.0] - 2026-04-01

### Changed

- **Lucide icons**: Replaced all hand-crafted inline SVGs with [Lucide](https://lucide.dev/) icons for consistency.
- **Run button**: Changed from a text button to a play icon.

### Fixed

- **Temporary terminals not appearing in sidebar**: Fixed a `ReferenceError` caused by using an undefined `SVG_TERMINAL` variable instead of the imported `ICON_TERMINAL` in the temporary terminals section of the sidebar.
- **Split button prefills instead of running**: Clicking the split button on a terminal now prefills the command instead of executing it immediately, matching the expected behavior.

### Added

- **Infinite terminal buffer**: All terminal output is now logged to disk per-session, providing effectively unlimited history.
- **Increased scrollback**: xterm.js scrollback increased from 5,000 to 50,000 lines for deeper in-memory history.
- **History search (Cmd+Shift+F)**: Full-text search across the entire terminal history, powered by disk-backed logs. Highlights matching results with line numbers.
- **Show Full Log**: New command palette action to open the raw terminal log file in your system editor.
- **History overlay**: When scrolling to the top of the terminal buffer, a seamless overlay appears showing older output loaded from disk. Supports lazy chunk loading (scroll up for more), in-overlay search (Cmd+F), and ANSI color rendering.
- **Log cleanup**: Terminal logs older than 7 days are automatically cleaned up on app startup.

- **Per-terminal starting folder**: Each terminal can now have a custom starting directory (relative to the project root). Configurable via the edit dialog. Defaults to the project root when not set.

### Changed

- **Single command per terminal**: Terminals now use a single `command` field instead of a `commands` array. Existing configs with multiple commands are automatically migrated (joined with `&&`). The dialog textarea has been replaced with a single-line input.
- **Prefill commands by default**: Clicking a terminal name in the sidebar opens it with the command prefilled but not executed — press Enter to run. A separate "Run" button opens the terminal and executes the command immediately.

### Fixed

- **Split button now splits the active tab**: The sidebar split button was always splitting the first terminal group for a project instead of the currently active one.

## [3.4.2] - 2026-03-31

### Changed

- **Numbered temporary terminals**: Temporary terminals in the sidebar and tab bar now show "Terminal 1", "Terminal 2", etc. instead of just "Terminal".
- **Removed New Terminal button from project actions**: The "+" New Terminal button has been removed from the project row in the sidebar.
- **New Terminal in command palette**: The command palette now includes a "New Terminal" action that opens a standalone terminal.
- **Fix tab switching to stay within active project**: Cmd+Left/Right now cycles only through the visible tabs for the current project, instead of jumping across all tab groups.
- **Per-terminal split pane**: Each terminal in the sidebar now has its own split button (visible on hover when the project is active). Clicking it opens that specific terminal with its configured commands as a split pane in the current tab group. The split button has been removed from the project-level actions.

## [3.4.1] - 2026-02-18

### Added

- **Git branch in sidebar**: Each project in the sidebar now shows the current git branch name below the project title.

## [3.4.0] - 2026-02-18

### Changed

- **No duplicate terminal instances**: Clicking a terminal in the sidebar that is already open now focuses it directly instead of opening a new instance. The "+" button still opens a new tab.
- **Projects expanded by default**: All projects with configured terminals are now expanded in the sidebar on startup, showing their terminal list immediately.
- **Removed "Projects" header title**: The "Projects" label above the project list has been removed for a cleaner sidebar.
- **Folder icon for projects**: Project icons now show a folder SVG instead of text initials, and the terminal count below the project name has been removed (path is always shown instead).
- **Removed "Run All" link**: The "Run All" option at the bottom of each terminal sub-list has been removed.

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
