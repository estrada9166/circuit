# Project Manager

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

The app is output to `dist/mac-arm64/Project Manager.app` (Apple Silicon) or `dist/mac/Project Manager.app` (Intel).

To install, drag the `.app` to your `/Applications` folder. or `open dist/mac-arm64/Project Manager.app` for Apple Silicon or `open dist/mac/Project Manager.app` for Intel.

> **Note:** Since the app is unsigned, macOS Gatekeeper may block it on first launch. Right-click the app and select **Open**, or go to **System Settings > Privacy & Security** and click **Open Anyway**.

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

Project data is stored in `~/.iterm-projects.json`. Window state is stored in `~/.iterm-projects-window.json`.
