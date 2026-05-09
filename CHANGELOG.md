# Changelog

## [Unreleased]

### Changed

- Reduced live terminal scrollback from 50,000 to 10,000 lines because full session history is already stored on disk, lowering renderer memory pressure in long-lived terminal sessions.
- Added Electron renderer crash/unresponsive logging to help diagnose cases where terminal UI stops drawing after Chromium compositor memory warnings.

### Fixed

- Fixed the history overlay trigger so scrolling behavior in pagers like `less` no longer opens the overlay when the terminal is back at the live prompt.
- Fixed a history overlay race where hiding the overlay while log chunks were still loading could throw `Cannot read properties of null (reading 'loadedOffset')`.

## [0.1.0] - 2026-04-19

### Added

- **Project manager**: Sidebar with project list, per-project color coding, and drag-and-drop reordering.
- **Integrated terminals**: node-pty + xterm.js terminals with tab support, split panes, and per-terminal color coding.
- **Saved commands**: Repository of shell commands (global or per-project) accessible via `Cmd+Shift+P`. Supports fuzzy search, add/edit/delete, and pastes the command into the terminal for review before running.
- **Temporary terminals**: Standalone terminals not tied to any project, numbered sequentially.
- **Infinite terminal history**: Output logged to disk per-session with lazy chunk loading when scrolling to the top. Logs older than 7 days are cleaned up on startup.
- **Inline terminal search (`⌘F`)**: Find text in the terminal buffer with match highlighting and next/previous navigation.
- **History search (`⌘⇧F`)**: Full-text search across the entire disk-backed terminal log.
- **Git panel**: Per-project git status with inline diffs.
- **Command palette (`⌘P`)**: Quick access to terminals, projects, and actions.
- **Keyboard navigation**: `⌘↑/↓` to cycle projects, `⌘←/→` to cycle tabs, `⌘K` to clear terminal.
- **Tab drag-and-drop**: Reorder terminal tabs by dragging.
- **Per-terminal starting folder**: Each terminal can have a custom starting directory relative to the project root.
- **Git branch in sidebar**: Current branch shown below each project name.
- **Shortcuts reference**: Keyboard icon in the sidebar bottom bar opens the full shortcut list.
