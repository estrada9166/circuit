/** A single named terminal configuration within a project */
export interface TerminalConfig {
  name: string;
  commands: string[];
}

/** A project with its terminal configurations */
export interface Project {
  name: string;
  path: string;
  terminals: TerminalConfig[];
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
export type UpdatableProjectFields = Partial<Pick<Project, 'path' | 'terminals'>>;

/** Data sent from main to renderer when a PTY is created */
export interface PtyCreatedEvent {
  id: string;
  projectName: string;
  terminalName: string;
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

  // Platform
  GET_HOMEDIR: 'platform:homedir',
  OPEN_EXTERNAL: 'platform:openExternal',
} as const;

/** The shape of window.api exposed by the preload script */
export interface PreloadApi {
  loadProjects(): Promise<Project[]>;
  addProject(project: { name: string; path: string; terminals?: TerminalConfig[] }): Promise<Project>;
  removeProject(name: string): Promise<void>;
  updateProject(name: string, fields: UpdatableProjectFields): Promise<Project>;
  reorderProjects(names: string[]): Promise<void>;
  openProject(projectName: string): Promise<string[]>;
  closeProject(projectName: string): Promise<void>;
  openSingleTerminal(projectName: string, terminalName: string): Promise<PtyCreatedEvent | null>;
  splitPane(ptyId: string): Promise<PtyCreatedEvent | null>;
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

  // Platform
  getHomedir(): string;
  openExternal(url: string): void;
}
