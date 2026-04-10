import { app, BrowserWindow, ipcMain, dialog, screen, Menu, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Store } from './store';
import { PtyManager } from './terminal';
import { findGitRepos, getFileDiff, getFullRepoDiff, getBranch } from './git';
import { IPC } from './types';
import type { WindowState } from './types';
import { TerminalLogger } from './terminal-logger';

const SIDEBAR_WIDTH = 280;
const LEGACY_WINDOW_STATE_FILE = path.join(os.homedir(), '.iterm-projects-window.json');
const LEGACY_STORE_FILE = path.join(os.homedir(), '.iterm-projects.json');

let mainWindow: BrowserWindow | null = null;
let store!: Store;
const ptyManager = new PtyManager();
let terminalLogger!: TerminalLogger;

// ---- Single instance lock ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ---- Window state persistence ----

function loadWindowState(): WindowState | null {
  const windowStateFile = getWindowStateFile();
  try {
    const raw = fs.readFileSync(windowStateFile, 'utf-8');
    return JSON.parse(raw) as WindowState;
  } catch {
    return null;
  }
}

let saveWindowStateTimer: ReturnType<typeof setTimeout> | null = null;

function saveWindowState(): void {
  const windowStateFile = getWindowStateFile();
  if (saveWindowStateTimer) return;
  saveWindowStateTimer = setTimeout(() => {
    saveWindowStateTimer = null;
    if (!mainWindow) return;
    const bounds = mainWindow.getBounds();
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: mainWindow.isMaximized(),
    };
    try {
      fs.mkdirSync(path.dirname(windowStateFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(windowStateFile, JSON.stringify(state), { mode: 0o600 });
    } catch { /* ignore */ }
  }, 500);
}

function saveWindowStateNow(): void {
  const windowStateFile = getWindowStateFile();
  if (saveWindowStateTimer) {
    clearTimeout(saveWindowStateTimer);
    saveWindowStateTimer = null;
  }
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: mainWindow.isMaximized(),
  };
  try {
    fs.mkdirSync(path.dirname(windowStateFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(windowStateFile, JSON.stringify(state), { mode: 0o600 });
  } catch { /* ignore */ }
}

function getWindowStateFile(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function getStoreFile(): string {
  return path.join(app.getPath('userData'), 'projects.json');
}

function migrateLegacyWindowStateIfNeeded(): void {
  const windowStateFile = getWindowStateFile();
  if (fs.existsSync(windowStateFile) || !fs.existsSync(LEGACY_WINDOW_STATE_FILE)) return;

  try {
    fs.mkdirSync(path.dirname(windowStateFile), { recursive: true, mode: 0o700 });
    fs.copyFileSync(LEGACY_WINDOW_STATE_FILE, windowStateFile);
  } catch {
    /* ignore */
  }
}

function getValidatedWindowState(): Partial<WindowState> {
  const saved = loadWindowState();
  if (!saved) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    return { width, height, x: 0, y: 0 };
  }

  // Validate bounds are within a visible display
  const displays = screen.getAllDisplays();
  const visible = displays.some(d => {
    const { x, y, width, height } = d.workArea;
    return saved.x >= x && saved.x < x + width && saved.y >= y && saved.y < y + height;
  });

  if (!visible) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    return { width, height, x: 0, y: 0 };
  }

  return saved;
}

// ---- App menu ----

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Terminal',
      submenu: [
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('open-command-palette');
          },
        },
        {
          label: 'Run Saved Command',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('open-run-command-palette');
          },
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Window creation ----

function createWindow(): void {
  const windowState = getValidatedWindowState();

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: SIDEBAR_WIDTH + 400,
    resizable: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#1c1c1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
  });

  // Restore maximized state
  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  // Save window state on changes (debounced for resize/move, immediate on close)
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);
  mainWindow.on('close', (event) => {
    saveWindowStateNow();
    app.quit();
   });

  // ---- Security: restrict navigation and new windows ----
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow opening URLs in the system browser
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', 'index.html'));
  ptyManager.setWindow(mainWindow);
}

// ---- Helper: resolve project path for git validation ----

function getProjectPathForRepo(repoPath: string): string | null {
  for (const project of store.projects) {
    const resolved = path.resolve(project.path);
    if (repoPath === resolved || repoPath.startsWith(resolved + path.sep)) {
      return resolved;
    }
  }
  return null;
}

// ---- App lifecycle ----

app.whenReady().then(() => {
  migrateLegacyWindowStateIfNeeded();
  store = new Store(getStoreFile(), LEGACY_STORE_FILE);
  terminalLogger = new TerminalLogger(path.join(app.getPath('userData'), 'terminal-logs'));

  // Load persisted projects before the renderer boots so initial `store:load`
  // doesn't race and render the empty state incorrectly.
  store.load();
  createMenu();
  terminalLogger.cleanOldLogs(7);
  ptyManager.setLogger(terminalLogger);

  // ---- Platform handlers (synchronous) ----
  ipcMain.on(IPC.GET_HOMEDIR, (event) => {
    event.returnValue = os.homedir();
  });

  ipcMain.on(IPC.OPEN_EXTERNAL, (_, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url);
    }
  });

  // ---- Store handlers ----
  ipcMain.handle(IPC.STORE_LOAD, () => store.projects);

  ipcMain.handle(IPC.STORE_ADD, (_, project: unknown) => {
    if (!project || typeof project !== 'object') throw new Error('Invalid project data');
    const p = project as Record<string, unknown>;
    if (typeof p.name !== 'string' || typeof p.path !== 'string') {
      throw new Error('Project must have name and path strings');
    }
    return store.addProject(project as { name: string; path: string; terminals?: []; color?: string });
  });

  ipcMain.handle(IPC.STORE_REMOVE, (_, name: unknown) => {
    if (typeof name !== 'string') throw new Error('Name must be a string');
    store.removeProject(name);
  });

  ipcMain.handle(IPC.STORE_UPDATE, (_, name: unknown, fields: unknown) => {
    if (typeof name !== 'string') throw new Error('Name must be a string');
    if (!fields || typeof fields !== 'object') throw new Error('Fields must be an object');
    return store.updateProject(name, fields as Record<string, unknown>);
  });

  ipcMain.handle(IPC.STORE_REORDER, (_, names: unknown) => {
    if (!Array.isArray(names) || !names.every(n => typeof n === 'string')) {
      throw new Error('Names must be an array of strings');
    }
    store.reorderProjects(names as string[]);
  });

  // ---- Saved Commands handlers ----
  ipcMain.handle(IPC.COMMANDS_LOAD, () => store.commands);

  ipcMain.handle(IPC.COMMANDS_ADD, (_, cmd: unknown) => {
    if (!cmd || typeof cmd !== 'object') throw new Error('Invalid command data');
    return store.addCommand(cmd as { name: string; command: string; description?: string; project?: string });
  });

  ipcMain.handle(IPC.COMMANDS_UPDATE, (_, index: unknown, cmd: unknown) => {
    if (typeof index !== 'number') throw new Error('Index must be a number');
    if (!cmd || typeof cmd !== 'object') throw new Error('Invalid command data');
    return store.updateCommand(index, cmd as { name: string; command: string; description?: string; project?: string });
  });

  ipcMain.handle(IPC.COMMANDS_REMOVE, (_, index: unknown) => {
    if (typeof index !== 'number') throw new Error('Index must be a number');
    store.removeCommand(index);
  });

  // ---- Project handlers ----

  ipcMain.handle(IPC.PROJECT_OPEN, (_, projectName: unknown) => {
    if (typeof projectName !== 'string') throw new Error('Project name must be a string');

    const project = store.projects.find(p => p.name === projectName);
    if (!project) throw new Error(`Project '${projectName}' not found`);

    if (ptyManager.hasProject(projectName)) {
      return ptyManager.getProjectPtyIds(projectName);
    }

    const ids = ptyManager.openProject(projectName, project.path, project.terminals);

    for (let i = 0; i < ids.length; i++) {
      const termName = project.terminals[i]?.name ?? 'shell';
      mainWindow?.webContents.send(IPC.TERMINAL_CREATED, {
        id: ids[i],
        projectName,
        terminalName: termName,
      });
    }

    return ids;
  });

  ipcMain.handle(IPC.PROJECT_CLOSE, (_, projectName: unknown) => {
    if (typeof projectName !== 'string') throw new Error('Project name must be a string');
    ptyManager.closeProject(projectName);
  });

  // Open a single terminal by name
  ipcMain.handle(IPC.PROJECT_OPEN_SINGLE_TERMINAL, (_, projectName: unknown, terminalName: unknown, prefill: unknown) => {
    if (typeof projectName !== 'string' || typeof terminalName !== 'string') {
      throw new Error('Project name and terminal name must be strings');
    }
    const project = store.projects.find(p => p.name === projectName);
    if (!project) return null;

    const termConfig = project.terminals.find(t => t.name === terminalName);
    const cwd = termConfig?.cwd ? path.resolve(project.path, termConfig.cwd) : project.path;

    const id = ptyManager.openSingleTerminal(projectName, cwd, terminalName, termConfig?.command, prefill === true);

    mainWindow?.webContents.send(IPC.TERMINAL_CREATED, {
      id,
      projectName,
      terminalName,
    });

    return { id, projectName, terminalName };
  });

  // New terminal tab for an existing project
  ipcMain.handle(IPC.PROJECT_NEW_TERMINAL, (_, projectName: unknown) => {
    if (typeof projectName !== 'string') throw new Error('Project name must be a string');
    const project = store.projects.find(p => p.name === projectName);
    if (!project) return null;

    const id = ptyManager.newTerminal(projectName, project.path);
    const termName = 'shell';

    mainWindow?.webContents.send(IPC.TERMINAL_CREATED, {
      id,
      projectName,
      terminalName: termName,
    });

    return { id, projectName, terminalName: termName };
  });

  // Get running terminal names for a project
  ipcMain.handle(IPC.PROJECT_RUNNING_TERMINALS, (_, projectName: unknown) => {
    if (typeof projectName !== 'string') throw new Error('Project name must be a string');
    return ptyManager.getRunningTerminalNames(projectName);
  });

  ipcMain.handle(IPC.PROJECT_SPLIT_WITH_TERMINAL, (_, projectName: unknown, terminalName: unknown) => {
    if (typeof projectName !== 'string' || typeof terminalName !== 'string') {
      throw new Error('Project name and terminal name must be strings');
    }
    const project = store.projects.find(p => p.name === projectName);
    if (!project) return null;

    const termConfig = project.terminals.find(t => t.name === terminalName);
    const cwd = termConfig?.cwd ? path.resolve(project.path, termConfig.cwd) : project.path;
    const id = ptyManager.openSingleTerminal(projectName, cwd, terminalName, termConfig?.command, true);
    return { id, projectName, terminalName };
  });

  ipcMain.handle(IPC.PROJECT_SPLIT, (_, ptyId: unknown) => {
    if (typeof ptyId !== 'string') throw new Error('PTY ID must be a string');
    const newId = ptyManager.split(ptyId);
    if (!newId) return null;
    const info = ptyManager.getSessionInfo(newId);
    return info ? { id: newId, projectName: info.projectName, terminalName: info.terminalName } : null;
  });

  ipcMain.handle(IPC.PROJECT_GET_ACTIVE, () => ptyManager.getActiveProjects());

  // ---- Terminal IPC ----

  ipcMain.handle(IPC.TERMINAL_OPEN_STANDALONE, () => {
    const id = ptyManager.create('', 'shell', os.homedir());
    const event = { id, projectName: '', terminalName: 'shell' };
    mainWindow?.webContents.send(IPC.TERMINAL_CREATED, event);
    return event;
  });

  ipcMain.on(IPC.TERMINAL_INPUT, (_, ptyId: string, data: string) => {
    if (typeof ptyId !== 'string' || typeof data !== 'string') return;
    ptyManager.write(ptyId, data);
  });

  ipcMain.on(IPC.TERMINAL_RESIZE, (_, ptyId: string, cols: number, rows: number) => {
    if (typeof ptyId !== 'string' || typeof cols !== 'number' || typeof rows !== 'number') return;
    ptyManager.resize(ptyId, cols, rows);
  });

  ipcMain.handle(IPC.TERMINAL_CLOSE, (_, ptyId: unknown) => {
    if (typeof ptyId !== 'string') throw new Error('PTY ID must be a string');
    ptyManager.close(ptyId);
  });

  // ---- Native folder picker ----

  ipcMain.handle(IPC.DIALOG_SELECT_DIR, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // ---- Git handlers (async, validated) ----

  ipcMain.handle(IPC.GIT_SCAN, async (_, projectPath: unknown) => {
    if (typeof projectPath !== 'string') throw new Error('Path must be a string');
    // Validate the path belongs to a known project
    const project = store.projects.find(p => path.resolve(p.path) === path.resolve(projectPath));
    if (!project) throw new Error('Path does not match any project');
    return findGitRepos(projectPath);
  });

  ipcMain.handle(IPC.GIT_FILE_DIFF, async (_, repoPath: unknown, filePath: unknown) => {
    if (typeof repoPath !== 'string' || typeof filePath !== 'string') {
      throw new Error('Paths must be strings');
    }
    const allowedRoot = getProjectPathForRepo(repoPath);
    if (!allowedRoot) throw new Error('Repository path not within any project');
    return getFileDiff(repoPath, filePath, allowedRoot);
  });

  ipcMain.handle(IPC.GIT_BRANCH, async (_, projectPath: unknown) => {
    if (typeof projectPath !== 'string') throw new Error('Path must be a string');
    const project = store.projects.find(p => path.resolve(p.path) === path.resolve(projectPath));
    if (!project) throw new Error('Path does not match any project');
    return getBranch(projectPath);
  });

  ipcMain.handle(IPC.GIT_REPO_DIFF, async (_, repoPath: unknown) => {
    if (typeof repoPath !== 'string') throw new Error('Path must be a string');
    const allowedRoot = getProjectPathForRepo(repoPath);
    if (!allowedRoot) throw new Error('Repository path not within any project');
    return getFullRepoDiff(repoPath, allowedRoot);
  });

  // ---- Log handlers ----

  ipcMain.handle(IPC.LOG_OPEN_EXTERNAL, (_, ptyId: unknown) => {
    if (typeof ptyId !== 'string') throw new Error('PTY ID must be a string');
    const logPath = terminalLogger.getLogPath(ptyId);
    shell.openPath(logPath);
  });

  ipcMain.handle(IPC.LOG_READ_CHUNK, (_, ptyId: unknown, offset: unknown, size: unknown) => {
    if (typeof ptyId !== 'string' || typeof offset !== 'number' || typeof size !== 'number') {
      throw new Error('Invalid arguments');
    }
    return terminalLogger.readChunk(ptyId, offset, size);
  });

  ipcMain.handle(IPC.LOG_GET_SIZE, (_, ptyId: unknown) => {
    if (typeof ptyId !== 'string') throw new Error('PTY ID must be a string');
    return terminalLogger.getLogSize(ptyId);
  });

  ipcMain.handle(IPC.LOG_SEARCH, (_, ptyId: unknown, query: unknown) => {
    if (typeof ptyId !== 'string' || typeof query !== 'string') {
      throw new Error('Invalid arguments');
    }
    return terminalLogger.search(ptyId, query);
  });

  createWindow();
});

app.on('before-quit', () => {
  ptyManager.killAll();
});

// Exit when all windows are closed on any platform
app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
