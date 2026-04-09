# Circuit

A macOS desktop app for managing multiple software projects with integrated terminal sessions, preconfigured commands, and git status tracking.

## Features

- Manage multiple projects with named terminal configurations
- Integrated terminal sessions powered by xterm.js and node-pty
- Split terminal panes
- Run preconfigured commands per project
- Git repository scanning with diff visualization
- Persistent project and window state

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [pnpm](https://pnpm.io/)

## Setup

```bash
# Install dependencies
pnpm install

# Build and run in development
pnpm start
```

## Development

```bash
# Full build (compiles TypeScript, bundles renderer, copies CSS)
pnpm run build

# Watch mode (rebuilds on file changes)
pnpm run build:watch

# Run the app (automatically builds first)
pnpm start
```

## Build Standalone App

Build a standalone `.app` bundle for local use (no Apple Developer signing required):

```bash
pnpm run pack
```

The app is output to `dist/mac-arm64/Circuit.app` (Apple Silicon) or `dist/mac/Circuit.app` (Intel).

To install, drag the `.app` to your `/Applications` folder. or `open "dist/mac-arm64/Circuit.app"` for Apple Silicon or `open "dist/mac/Circuit.app"` for Intel.

> **Note:** Since the app is unsigned, macOS Gatekeeper may block it on first launch. Right-click the app and select **Open**, or go to **System Settings > Privacy & Security** and click **Open Anyway**.

## Build Signed Release Artifacts

Build signed release artifacts for distribution:

```bash
pnpm run dist
```

By default, Electron Builder now produces macOS `dmg` and `zip` artifacts for `Circuit`.

To enable notarization, set these environment variables before running `pnpm run dist`:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YOURTEAMID"
```

To use a branded app icon, add `build/icon.icns`. Until that file exists, Electron Builder will fall back to Electron's default icon.

## Project Structure

```
src/
├── main.ts              # Electron main process
├── preload.ts           # IPC bridge (context isolation)
├── types.ts             # Shared TypeScript types and IPC channels
├── store.ts             # Project configuration persistence
├── terminal.ts          # PTY management
├── git.ts               # Git repo scanning and diffs
├── migration.ts         # Config version migration
└── renderer/            # Renderer process (UI)
    ├── index.ts         # Entry point
    ├── sidebar.ts       # Project/terminal sidebar
    ├── terminal-ui.ts   # Terminal session rendering and tabs
    ├── git-panel.ts     # Git diff visualization
    ├── dialogs.ts       # Edit/remove project dialogs
    ├── state.ts         # UI state management
    └── utils.ts         # Utility functions
```

## Configuration

Project data is stored in the app's macOS user-data directory. Existing installs that used `~/.iterm-projects.json` and `~/.iterm-projects-window.json` are migrated automatically on first launch.
