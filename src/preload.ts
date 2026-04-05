import { contextBridge, ipcRenderer } from 'electron';
import type { PreloadApi, PtyCreatedEvent, GitRepoInfo } from './types';
import { IPC } from './types';

// Get homedir synchronously via IPC (os module unavailable in sandboxed preload)
const homedir: string = ipcRenderer.sendSync(IPC.GET_HOMEDIR);

const api: PreloadApi = {
  loadProjects: () => ipcRenderer.invoke(IPC.STORE_LOAD),
  addProject: (project) => ipcRenderer.invoke(IPC.STORE_ADD, project),
  removeProject: (name) => ipcRenderer.invoke(IPC.STORE_REMOVE, name),
  updateProject: (name, fields) => ipcRenderer.invoke(IPC.STORE_UPDATE, name, fields),
  reorderProjects: (names) => ipcRenderer.invoke(IPC.STORE_REORDER, names),
  openProject: (projectName) => ipcRenderer.invoke(IPC.PROJECT_OPEN, projectName),
  closeProject: (projectName) => ipcRenderer.invoke(IPC.PROJECT_CLOSE, projectName),
  openSingleTerminal: (projectName: string, terminalName: string, prefill?: boolean) => ipcRenderer.invoke(IPC.PROJECT_OPEN_SINGLE_TERMINAL, projectName, terminalName, prefill),
  splitPane: (ptyId: string) => ipcRenderer.invoke(IPC.PROJECT_SPLIT, ptyId),
  splitWithTerminal: (projectName: string, terminalName: string) => ipcRenderer.invoke(IPC.PROJECT_SPLIT_WITH_TERMINAL, projectName, terminalName),
  newTerminal: (projectName: string) => ipcRenderer.invoke(IPC.PROJECT_NEW_TERMINAL, projectName),
  getActiveProjects: () => ipcRenderer.invoke(IPC.PROJECT_GET_ACTIVE),
  getRunningTerminals: (projectName: string) => ipcRenderer.invoke(IPC.PROJECT_RUNNING_TERMINALS, projectName),
  selectDirectory: () => ipcRenderer.invoke(IPC.DIALOG_SELECT_DIR),
  openStandaloneTerminal: () => ipcRenderer.invoke(IPC.TERMINAL_OPEN_STANDALONE),

  // Terminal IPC
  terminalInput: (ptyId: string, data: string) => {
    ipcRenderer.send(IPC.TERMINAL_INPUT, ptyId, data);
  },
  terminalResize: (ptyId: string, cols: number, rows: number) => {
    ipcRenderer.send(IPC.TERMINAL_RESIZE, ptyId, cols, rows);
  },
  terminalClose: (ptyId: string) => {
    return ipcRenderer.invoke(IPC.TERMINAL_CLOSE, ptyId);
  },

  // Listeners with unsubscribe support
  onTerminalOutput: (callback: (ptyId: string, data: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ptyId: string, data: string) =>
      callback(ptyId, data);
    ipcRenderer.on(IPC.TERMINAL_OUTPUT, handler);
    return () => { ipcRenderer.removeListener(IPC.TERMINAL_OUTPUT, handler); };
  },
  onTerminalCreated: (callback: (event: PtyCreatedEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, evt: PtyCreatedEvent) => callback(evt);
    ipcRenderer.on(IPC.TERMINAL_CREATED, handler);
    return () => { ipcRenderer.removeListener(IPC.TERMINAL_CREATED, handler); };
  },
  onTerminalExited: (callback: (ptyId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ptyId: string) => callback(ptyId);
    ipcRenderer.on(IPC.TERMINAL_EXITED, handler);
    return () => { ipcRenderer.removeListener(IPC.TERMINAL_EXITED, handler); };
  },

  // Git IPC — returns raw diff strings (rendered on renderer side)
  scanGitRepos: (projectPath: string): Promise<GitRepoInfo[]> => {
    return ipcRenderer.invoke(IPC.GIT_SCAN, projectPath);
  },
  getFileDiff: (repoPath: string, filePath: string) => {
    return ipcRenderer.invoke(IPC.GIT_FILE_DIFF, repoPath, filePath);
  },
  getRepoDiff: (repoPath: string) => {
    return ipcRenderer.invoke(IPC.GIT_REPO_DIFF, repoPath);
  },
  getBranch: (projectPath: string) => {
    return ipcRenderer.invoke(IPC.GIT_BRANCH, projectPath);
  },

  // Log
  openLogFile: (ptyId: string) => ipcRenderer.invoke(IPC.LOG_OPEN_EXTERNAL, ptyId),
  readLogChunk: (ptyId: string, offset: number, size: number) => ipcRenderer.invoke(IPC.LOG_READ_CHUNK, ptyId, offset, size),
  getLogSize: (ptyId: string) => ipcRenderer.invoke(IPC.LOG_GET_SIZE, ptyId),
  searchLog: (ptyId: string, query: string) => ipcRenderer.invoke(IPC.LOG_SEARCH, ptyId, query),

  // Command palette
  onOpenCommandPalette: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('open-command-palette', handler);
    return () => { ipcRenderer.removeListener('open-command-palette', handler); };
  },

  // Platform
  getHomedir: () => homedir,
  openExternal: (url: string) => {
    ipcRenderer.send(IPC.OPEN_EXTERNAL, url);
  },
};

contextBridge.exposeInMainWorld('api', api);
