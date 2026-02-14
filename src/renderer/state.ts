import type { Project, GitRepoInfo, TerminalConfig } from '../types';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

// ---- Core state ----

export let projects: Project[] = [];
export let activeProjects: string[] = [];
export let editingProject: Project | null = null;
export let removingProject: Project | null = null;

export let editTerminals: TerminalConfig[] = [];
export let addTerminals: TerminalConfig[] = [];

export function setProjects(p: Project[]): void { projects = p; }
export function setActiveProjects(a: string[]): void { activeProjects = a; }
export function setEditingProject(p: Project | null): void { editingProject = p; }
export function setRemovingProject(p: Project | null): void { removingProject = p; }
export function setEditTerminals(t: TerminalConfig[]): void { editTerminals = t; }
export function setAddTerminals(t: TerminalConfig[]): void { addTerminals = t; }

// ---- Terminal state ----

export interface TerminalSession {
  id: string;
  projectName: string;
  terminalName: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLDivElement;
  groupId: string;
  disposables: { dispose(): void }[];
}

export interface TabGroup {
  id: string;
  projectName: string;
  label: string;
  sessionIds: string[];
  element: HTMLDivElement;
  color?: string;
}

export const sessions = new Map<string, TerminalSession>();
export const tabGroups = new Map<string, TabGroup>();
export let activeGroupId: string | null = null;
export let focusedSessionId: string | null = null;

export function setActiveGroupId(id: string | null): void { activeGroupId = id; }
export function setFocusedSessionId(id: string | null): void { focusedSessionId = id; }

let groupIdCounter = 0;
export function nextGroupId(): string {
  return `group-${++groupIdCounter}`;
}

// ---- Git panel state ----

export let gitPanelProject: Project | null = null;
export let gitRepos: GitRepoInfo[] = [];
export let gitLoading = false;
export const expandedRepos = new Set<string>();
export const expandedFileDiffs = new Map<string, string | null>();
export const expandedRepoDiffs = new Map<string, string | null>();

export function setGitPanelProject(p: Project | null): void { gitPanelProject = p; }
export function setGitRepos(r: GitRepoInfo[]): void { gitRepos = r; }
export function setGitLoading(l: boolean): void { gitLoading = l; }

export function fileDiffKey(repoPath: string, filePath: string): string {
  return `${repoPath}\0${filePath}`;
}

// ---- Notification / expand state ----

export const notifiedSessionIds = new Set<string>();
export const expandedProjectNames = new Set<string>();
export const runningTerminalNames = new Map<string, string[]>();
