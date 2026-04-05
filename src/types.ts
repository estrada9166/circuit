/** A single named terminal configuration within a project */
export interface TerminalConfig {
  name: string;
  command?: string;
  color?: string;
  cwd?: string;
}

/** A project with its terminal configurations */
export interface Project {
  name: string;
  path: string;
  terminals: TerminalConfig[];
  color?: string;
}

/** Old project format with flat commands array (for migration) */
export interface LegacyProject {
  name: string;
  path: string;
  commands: string[];
}

export type StoredProject = Project | LegacyProject;

/** Top-level structure of the JSON config file */
export interface StoreData {
  version?: number;
  projects: StoredProject[];
}

/** Fields that can be updated via store:update */
export type UpdatableProjectFields = Partial<Pick<Project, 'path' | 'terminals' | 'color'>>;

/** Data sent from main to renderer when a PTY is created */
export interface PtyCreatedEvent {
  id: string;
  projectName: string;
  terminalName: string;
}

export interface LogSearchResult {
  lineNumber: number;
  text: string;
  offset: number;
}

export interface GitFileInfo {
  status: string;
  file: string;
}

export interface GitRepoInfo {
  path: string;
  name: string;
  files: GitFileInfo[];
}

/** Window state for persistence */
export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

// ---- IPC Channel Constants ----

export const IPC = {
  // Store
  STORE_LOAD: 'store:load',
  STORE_ADD: 'store:add',
  STORE_REMOVE: 'store:remove',
  STORE_UPDATE: 'store:update',
  STORE_REORDER: 'store:reorder',

  // Project
  PROJECT_OPEN: 'project:open',
  PROJECT_CLOSE: 'project:close',
  PROJECT_OPEN_SINGLE_TERMINAL: 'project:openSingleTerminal',
  PROJECT_SPLIT: 'project:split',
  PROJECT_SPLIT_WITH_TERMINAL: 'project:splitWithTerminal',
  PROJECT_NEW_TERMINAL: 'project:newTerminal',
  PROJECT_GET_ACTIVE: 'project:getActive',
  PROJECT_RUNNING_TERMINALS: 'project:runningTerminals',

  // Terminal
  TERMINAL_OPEN_STANDALONE: 'terminal:openStandalone',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_CLOSE: 'terminal:close',
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_CREATED: 'terminal:created',
  TERMINAL_EXITED: 'terminal:exited',

  // Dialog
  DIALOG_SELECT_DIR: 'dialog:selectDir',

  // Git
  GIT_SCAN: 'git:scan',
  GIT_FILE_DIFF: 'git:fileDiff',
  GIT_REPO_DIFF: 'git:repoDiff',
  GIT_BRANCH: 'git:branch',

  // Log
  LOG_OPEN_EXTERNAL: 'log:openExternal',
  LOG_READ_CHUNK: 'log:readChunk',
  LOG_GET_SIZE: 'log:getSize',
  LOG_SEARCH: 'log:search',

  // Platform
  GET_HOMEDIR: 'platform:homedir',
  OPEN_EXTERNAL: 'platform:openExternal',
} as const;

/** The shape of window.api exposed by the preload script */
export interface PreloadApi {
  loadProjects(): Promise<Project[]>;
  addProject(project: { name: string; path: string; terminals?: TerminalConfig[]; color?: string }): Promise<Project>;
  removeProject(name: string): Promise<void>;
  updateProject(name: string, fields: UpdatableProjectFields): Promise<Project>;
  reorderProjects(names: string[]): Promise<void>;
  openProject(projectName: string): Promise<string[]>;
  closeProject(projectName: string): Promise<void>;
  openSingleTerminal(projectName: string, terminalName: string, prefill?: boolean): Promise<PtyCreatedEvent | null>;
  splitPane(ptyId: string): Promise<PtyCreatedEvent | null>;
  splitWithTerminal(projectName: string, terminalName: string): Promise<PtyCreatedEvent | null>;
  newTerminal(projectName: string): Promise<PtyCreatedEvent | null>;
  getActiveProjects(): Promise<string[]>;
  getRunningTerminals(projectName: string): Promise<string[]>;
  selectDirectory(): Promise<string | null>;
  openStandaloneTerminal(): Promise<PtyCreatedEvent>;

  // Terminal IPC
  terminalInput(ptyId: string, data: string): void;
  terminalResize(ptyId: string, cols: number, rows: number): void;
  terminalClose(ptyId: string): Promise<void>;
  onTerminalOutput(callback: (ptyId: string, data: string) => void): () => void;
  onTerminalCreated(callback: (event: PtyCreatedEvent) => void): () => void;
  onTerminalExited(callback: (ptyId: string) => void): () => void;

  // Git IPC — returns raw diff strings, rendered on renderer side
  scanGitRepos(projectPath: string): Promise<GitRepoInfo[]>;
  getFileDiff(repoPath: string, filePath: string): Promise<string>;
  getRepoDiff(repoPath: string): Promise<string>;
  getBranch(projectPath: string): Promise<string | null>;

  // Log
  openLogFile(ptyId: string): Promise<void>;
  readLogChunk(ptyId: string, offset: number, size: number): Promise<string>;
  getLogSize(ptyId: string): Promise<number>;
  searchLog(ptyId: string, query: string): Promise<LogSearchResult[]>;

  // Command palette
  onOpenCommandPalette(callback: () => void): () => void;

  // Platform
  getHomedir(): string;
  openExternal(url: string): void;
}
