# Project Rules

## Overview

Electron desktop app (macOS) — a project manager with integrated terminals. Uses TypeScript, xterm.js, node-pty, and esbuild.

## Build

```
npm run build
```

Compiles main (tsc), preload (esbuild), and renderer (esbuild) in sequence. No test suite.

## Architecture

- `src/main.ts` — Electron main process (window, IPC, store, git)
- `src/preload.ts` — context bridge API
- `src/renderer/` — modular renderer (sidebar, terminal-ui, dialogs, command-palette, git-panel, state)
- `index.html` — single HTML file with all CSS inline
- State is managed via plain Maps/Sets in `src/renderer/state.ts` (no framework)
- Cross-module communication uses callback wiring in `src/renderer/index.ts` to avoid circular deps

## Patterns

- All CSS lives in `index.html` `<style>` block — no external stylesheets (except xterm/diff2html vendor CSS)
- Drag-and-drop uses native HTML5 API (`draggable`, `dragstart`/`dragover`/`drop` events)
- Overlays use `hidden` attribute toggling (not CSS display classes)
- Keyboard shortcuts are intercepted in two places:
  - `terminal-ui.ts` `attachCustomKeyEventHandler` — returns `false` to let Cmd/Ctrl combos bubble up from xterm
  - `index.ts` global `keydown` listener — handles all app-level shortcuts
- Tab groups are stored in a `Map` (insertion-order preserved). Reordering rebuilds the Map.

## Conventions

- Keep changes minimal — don't refactor surrounding code
- Prefer editing existing files over creating new ones
- All UI text uses `esc()` helper for XSS safety
- Build must pass (`npm run build`) before considering work done

## Changelog

All changes are tracked in `CHANGELOG.md` at the project root. Update it when adding features or fixing bugs.
