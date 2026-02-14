import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

export {};

interface TerminalConfig {
  name: string;
  commands: string[];
}

interface Project {
  name: string;
  path: string;
  terminals: TerminalConfig[];
}

interface PtyCreatedEvent {
  id: string;
  projectName: string;
  terminalName: string;
}

interface GitFileInfo {
  status: string;
  file: string;
}

interface GitRepoInfo {
  path: string;
  name: string;
  files: GitFileInfo[];
}

interface Api {
  loadProjects(): Promise<Project[]>;
  addProject(project: { name: string; path: string; terminals?: TerminalConfig[] }): Promise<Project>;
  removeProject(name: string): Promise<void>;
  updateProject(name: string, fields: { path?: string; terminals?: TerminalConfig[] }): Promise<Project>;
  openProject(projectName: string): Promise<string[]>;
  closeProject(projectName: string): Promise<void>;
  openSingleTerminal(projectName: string, terminalName: string): Promise<PtyCreatedEvent | null>;
  splitPane(ptyId: string): Promise<PtyCreatedEvent | null>;
  newTerminal(projectName: string): Promise<PtyCreatedEvent | null>;
  getActiveProjects(): Promise<string[]>;
  getRunningTerminals(projectName: string): Promise<string[]>;
  selectDirectory(): Promise<string | null>;
  terminalInput(ptyId: string, data: string): void;
  terminalResize(ptyId: string, cols: number, rows: number): void;
  terminalClose(ptyId: string): Promise<void>;
  onTerminalOutput(callback: (ptyId: string, data: string) => void): void;
  onTerminalCreated(callback: (event: PtyCreatedEvent) => void): void;
  onTerminalExited(callback: (ptyId: string) => void): void;
  scanGitRepos(projectPath: string): Promise<GitRepoInfo[]>;
  getFileDiff(repoPath: string, filePath: string): Promise<string>;
  getRepoDiff(repoPath: string): Promise<string>;
  getHomedir(): string;
}

declare global {
  interface Window {
    api: Api;
  }
}

// ---- State ----

let projects: Project[] = [];
let activeProjects: string[] = [];
let editingProject: Project | null = null;
let removingProject: Project | null = null;

let editTerminals: TerminalConfig[] = [];
let addTerminals: TerminalConfig[] = [];
const expandedProjectNames = new Set<string>();
const runningTerminalNames = new Map<string, string[]>(); // projectName -> running terminal names
const notifiedSessionIds = new Set<string>(); // sessions with unread output

// ---- Terminal state ----

interface TerminalSession {
  id: string;
  projectName: string;
  terminalName: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLDivElement; // .split-terminal wrapper
  groupId: string;
}

interface TabGroup {
  id: string;
  projectName: string;
  label: string;
  sessionIds: string[];
  element: HTMLDivElement; // .terminal-pane container
}

const sessions = new Map<string, TerminalSession>();
const tabGroups = new Map<string, TabGroup>();
let activeGroupId: string | null = null;
let focusedSessionId: string | null = null;

// ---- Git panel state ----

let gitPanelProject: Project | null = null;
let gitRepos: GitRepoInfo[] = [];
let gitLoading = false;
let expandedRepos = new Set<string>();

// Inline diff state: value is HTML string when loaded, null when loading, absent when collapsed
const expandedFileDiffs = new Map<string, string | null>();
const expandedRepoDiffs = new Map<string, string | null>();

// ---- DOM refs ----

const list = document.getElementById('project-list')!;
const emptyState = document.getElementById('empty-state')!;

const terminalTabs = document.getElementById('terminal-tabs')!;
const terminalContainer = document.getElementById('terminal-container')!;
const terminalEmptyState = document.getElementById('terminal-empty-state')!;

const addDialog = document.getElementById('add-dialog') as HTMLDialogElement;
const addName = document.getElementById('add-name') as HTMLInputElement;
const addPath = document.getElementById('add-path') as HTMLInputElement;
const addError = document.getElementById('add-error')!;
const addTerminalsContainer = document.getElementById('add-terminals-container')!;

const editDialog = document.getElementById('edit-dialog') as HTMLDialogElement;
const editProjectName = document.getElementById('edit-project-name')!;
const editError = document.getElementById('edit-error')!;
const editTerminalsContainer = document.getElementById('edit-terminals-container')!;

const removeDialog = document.getElementById('remove-dialog') as HTMLDialogElement;
const removeProjectNameEl = document.getElementById('remove-project-name')!;

// ---- Helpers ----

function esc(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s-_]+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function shortenPath(p: string): string {
  const home = '/Users/';
  if (p.startsWith(home)) {
    const afterHome = p.substring(home.length);
    const slashIdx = afterHome.indexOf('/');
    if (slashIdx >= 0) {
      return '~' + afterHome.substring(slashIdx);
    }
  }
  return p;
}

let groupIdCounter = 0;
function nextGroupId(): string {
  return `group-${++groupIdCounter}`;
}

// ---- Terminal session creation ----

function makeTerminalSession(
  id: string,
  projectName: string,
  terminalName: string,
  groupId: string,
): TerminalSession {
  const terminal = new Terminal({
    theme: {
      background: '#1c1c1e',
      foreground: '#f5f5f7',
      cursor: '#f5f5f7',
      selectionBackground: 'rgba(255, 255, 255, 0.2)',
      black: '#1c1c1e',
      red: '#ff453a',
      green: '#32d74b',
      yellow: '#ffd60a',
      blue: '#0a84ff',
      magenta: '#bf5af2',
      cyan: '#64d2ff',
      white: '#f5f5f7',
    },
    fontSize: 13,
    fontFamily: '"SF Mono", Menlo, monospace',
    cursorBlink: true,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());

  const wrapper = document.createElement('div');
  wrapper.className = 'split-terminal';
  wrapper.dataset.ptyId = id;

  // Close button for this pane
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pane-close';
  closeBtn.title = 'Close pane';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.api.terminalClose(id);
    removeSession(id);
  });
  wrapper.appendChild(closeBtn);

  terminal.open(wrapper);

  // Forward keystrokes to PTY
  terminal.onData((data: string) => {
    window.api.terminalInput(id, data);
  });

  // Notify PTY of resize
  terminal.onResize(({ cols, rows }) => {
    window.api.terminalResize(id, cols, rows);
  });

  // Click to focus this pane
  wrapper.addEventListener('mousedown', () => {
    focusSession(id);
  });

  return { id, projectName, terminalName, terminal, fitAddon, element: wrapper, groupId };
}

// ---- Tab group management ----

function createTabGroup(session: TerminalSession): TabGroup {
  const gid = nextGroupId();

  const pane = document.createElement('div');
  pane.className = 'terminal-pane';
  pane.dataset.groupId = gid;
  pane.appendChild(session.element);

  terminalContainer.appendChild(pane);

  const group: TabGroup = {
    id: gid,
    projectName: session.projectName,
    label: `${session.projectName}: ${session.terminalName}`,
    sessionIds: [session.id],
    element: pane,
  };

  session.groupId = gid;
  tabGroups.set(gid, group);
  return group;
}

function fitGroupSessions(group: TabGroup): void {
  requestAnimationFrame(() => {
    for (const sid of group.sessionIds) {
      const s = sessions.get(sid);
      if (s) {
        s.fitAddon.fit();
        window.api.terminalResize(sid, s.terminal.cols, s.terminal.rows);
      }
    }
  });
}

function activateGroup(groupId: string): void {
  activeGroupId = groupId;

  for (const [gid, group] of tabGroups) {
    if (gid === groupId) {
      group.element.classList.add('active');
      fitGroupSessions(group);
      // Clear notifications for this group's sessions
      for (const sid of group.sessionIds) {
        notifiedSessionIds.delete(sid);
      }
      // Focus the previously focused session or the first one
      const toFocus = focusedSessionId && group.sessionIds.includes(focusedSessionId)
        ? focusedSessionId
        : group.sessionIds[0];
      if (toFocus) focusSession(toFocus);
    } else {
      group.element.classList.remove('active');
    }
  }

  renderTerminalTabs();
  render();
}

function focusSession(sessionId: string): void {
  focusedSessionId = sessionId;

  for (const [, session] of sessions) {
    session.element.classList.toggle('focused', session.id === sessionId);
  }

  const session = sessions.get(sessionId);
  if (session) {
    session.terminal.focus();
  }
}

function closeGroup(groupId: string): void {
  const group = tabGroups.get(groupId);
  if (!group) return;

  for (const sid of [...group.sessionIds]) {
    window.api.terminalClose(sid);
    const session = sessions.get(sid);
    if (session) {
      session.terminal.dispose();
      sessions.delete(sid);
    }
  }

  group.element.remove();
  tabGroups.delete(groupId);

  if (activeGroupId === groupId) {
    const remaining = [...tabGroups.keys()];
    activeGroupId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    if (activeGroupId) {
      activateGroup(activeGroupId);
    } else {
      focusedSessionId = null;
    }
  }

  renderTerminalTabs();

  if (tabGroups.size === 0) {
    terminalEmptyState.hidden = false;
  }

  updateActiveProjects();
}

function removeSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;

  session.terminal.dispose();

  const group = tabGroups.get(session.groupId);
  if (group) {
    const idx = group.sessionIds.indexOf(id);
    if (idx !== -1) {
      group.sessionIds.splice(idx, 1);

      // Remove the element and its adjacent divider
      const prev = session.element.previousElementSibling;
      const next = session.element.nextElementSibling;
      if (prev && prev.classList.contains('split-divider')) {
        prev.remove();
      } else if (next && next.classList.contains('split-divider')) {
        next.remove();
      }
      session.element.remove();

      if (group.sessionIds.length === 0) {
        group.element.remove();
        tabGroups.delete(group.id);

        if (activeGroupId === group.id) {
          const remaining = [...tabGroups.keys()];
          activeGroupId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
          if (activeGroupId) {
            activateGroup(activeGroupId);
          } else {
            focusedSessionId = null;
          }
        }
      } else {
        // Fit remaining terminals in the group
        fitGroupSessions(group);

        if (focusedSessionId === id) {
          focusSession(group.sessionIds[0]);
        }
      }
    }
  }

  sessions.delete(id);
  renderTerminalTabs();

  if (tabGroups.size === 0) {
    terminalEmptyState.hidden = false;
  }

  updateActiveProjects();
}

// ---- Split ----

async function splitSession(sessionId: string): Promise<void> {
  const existing = sessions.get(sessionId);
  if (!existing) return;

  const result = await window.api.splitPane(sessionId);
  if (!result) return;

  const group = tabGroups.get(existing.groupId);
  if (!group) return;

  // Create new session and add to the same group
  const newSession = makeTerminalSession(result.id, result.projectName, result.terminalName, group.id);
  sessions.set(result.id, newSession);

  // Add divider + new pane to the group element
  const divider = document.createElement('div');
  divider.className = 'split-divider';
  group.element.appendChild(divider);
  group.element.appendChild(newSession.element);

  group.sessionIds.push(result.id);

  // Fit all terminals in the group (widths changed)
  fitGroupSessions(group);

  // Focus the new split pane
  focusSession(result.id);

  renderTerminalTabs();
  updateActiveProjects();
}

// ---- Tab bar rendering ----

function renderTerminalTabs(): void {
  // If git panel is active, use the git tab renderer instead
  if (gitPanelProject) {
    renderGitTab();
    return;
  }

  terminalTabs.innerHTML = '';

  for (const [groupId, group] of tabGroups) {
    const hasNotification = group.sessionIds.some(sid => notifiedSessionIds.has(sid));
    const tab = document.createElement('div');
    tab.className = 'terminal-tab'
      + (groupId === activeGroupId ? ' active' : '')
      + (hasNotification ? ' has-notification' : '');

    const splitCount = group.sessionIds.length;
    const label = splitCount > 1
      ? `${group.label} (${splitCount})`
      : group.label;

    tab.innerHTML = `
      ${hasNotification ? '<span class="tab-notification"></span>' : ''}
      <span class="tab-label">${esc(label)}</span>
      <button class="tab-close" title="Close">&times;</button>
    `;

    tab.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.tab-close')) return;
      activateGroup(groupId);
    });

    tab.querySelector('.tab-close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      closeGroup(groupId);
    });

    terminalTabs.appendChild(tab);
  }
}

async function updateActiveProjects(): Promise<void> {
  activeProjects = await window.api.getActiveProjects();
  // Refresh running terminal names for expanded projects
  for (const name of expandedProjectNames) {
    const names = await window.api.getRunningTerminals(name);
    runningTerminalNames.set(name, names);
  }
  render();
}

// ---- Terminal IPC listeners ----

let notifyRenderTimeout: ReturnType<typeof setTimeout> | null = null;

window.api.onTerminalOutput((ptyId: string, data: string) => {
  const session = sessions.get(ptyId);
  if (session) {
    session.terminal.write(data);

    // If this session's group isn't the active one, mark as notified
    if (session.groupId !== activeGroupId) {
      if (!notifiedSessionIds.has(ptyId)) {
        notifiedSessionIds.add(ptyId);
        // Debounce re-render to avoid thrashing on rapid output
        if (!notifyRenderTimeout) {
          notifyRenderTimeout = setTimeout(() => {
            notifyRenderTimeout = null;
            renderTerminalTabs();
            render();
          }, 300);
        }
      }
    }
  }
});

window.api.onTerminalCreated((event: PtyCreatedEvent) => {
  if (sessions.has(event.id)) return;

  const session = makeTerminalSession(event.id, event.projectName, event.terminalName, '');
  sessions.set(event.id, session);

  const group = createTabGroup(session);

  terminalEmptyState.hidden = true;
  activateGroup(group.id);

  requestAnimationFrame(() => {
    session.fitAddon.fit();
    window.api.terminalResize(event.id, session.terminal.cols, session.terminal.rows);
  });
});

window.api.onTerminalExited((ptyId: string) => {
  removeSession(ptyId);
});

// Window resize handler
let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('resize', () => {
  if (resizeTimeout) clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (activeGroupId) {
      const group = tabGroups.get(activeGroupId);
      if (group) {
        fitGroupSessions(group);
      }
    }
  }, 100);
});

// ---- Render sidebar ----

function render(): void {
  list.innerHTML = '';
  emptyState.hidden = projects.length > 0;

  projects.forEach(project => {
    const li = document.createElement('li');
    li.className = 'project-item';

    const isActive = activeProjects.includes(project.name);
    if (isActive) li.classList.add('active');

    const isExpanded = expandedProjectNames.has(project.name);
    if (isExpanded) li.classList.add('expanded');

    const termCount = project.terminals.length;
    const hasTerminals = termCount > 0;
    const meta = hasTerminals
      ? `${termCount} terminal${termCount > 1 ? 's' : ''}`
      : shortenPath(project.path);

    const running = runningTerminalNames.get(project.name) || [];

    // Check if any session for this project has a notification
    const projectSessions = [...sessions.values()].filter(s => s.projectName === project.name);
    const hasProjectNotification = projectSessions.some(s => notifiedSessionIds.has(s.id));

    li.innerHTML = `
      <div class="project-row">
        ${hasTerminals ? `<div class="project-chevron${isExpanded ? ' open' : ''}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>` : ''}
        <div class="project-icon">${esc(initials(project.name))}</div>
        <div class="project-details">
          <div class="project-name">${esc(project.name)}</div>
          <div class="project-meta">${esc(meta)}</div>
        </div>
        ${hasProjectNotification ? '<div class="notification-indicator"></div>' : ''}
        ${isActive && !hasProjectNotification ? '<div class="active-indicator"></div>' : ''}
        <div class="project-actions">
          <button class="action-btn btn-git" title="Git Status">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>
          </button>
          <button class="action-btn btn-new-term" title="New Terminal">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          ${isActive ? `<button class="action-btn btn-split" title="Split Pane">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
          </button>` : ''}
          <button class="action-btn btn-edit" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="action-btn danger btn-remove" title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    `;

    // Terminal sub-list (expanded)
    if (isExpanded && hasTerminals) {
      const subList = document.createElement('ul');
      subList.className = 'terminal-sub-list';

      for (const term of project.terminals) {
        const isRunning = running.includes(term.name);
        const termHasNotification = projectSessions.some(
          s => s.terminalName === term.name && notifiedSessionIds.has(s.id)
        );
        const subItem = document.createElement('li');
        subItem.className = 'terminal-sub-item'
          + (isRunning ? ' running' : '')
          + (termHasNotification ? ' has-notification' : '');
        subItem.innerHTML = `
          <svg class="terminal-sub-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          <span class="terminal-sub-name">${esc(term.name)}</span>
          ${termHasNotification ? '<span class="terminal-sub-notification"></span>' : (isRunning ? '<span class="terminal-sub-running"></span>' : '')}
          <button class="terminal-sub-new" title="Open new tab">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button class="terminal-sub-delete" title="Remove terminal">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <span class="terminal-sub-action">${isRunning ? 'Focus' : 'Run'}</span>
        `;

        // Click row: focus if running, launch if not
        subItem.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.terminal-sub-new')) return;
          if ((e.target as HTMLElement).closest('.terminal-sub-delete')) return;
          e.stopPropagation();
          if (isRunning) {
            const session = [...sessions.values()].find(
              s => s.projectName === project.name && s.terminalName === term.name
            );
            if (session) {
              const group = tabGroups.get(session.groupId);
              if (group) {
                if (gitPanelProject) closeGitPanel();
                activateGroup(group.id);
                focusSession(session.id);
              }
            }
          } else {
            window.api.openSingleTerminal(project.name, term.name);
          }
        });

        // "+" button: always open a new tab for this terminal
        subItem.querySelector('.terminal-sub-new')!.addEventListener('click', (e) => {
          e.stopPropagation();
          window.api.openSingleTerminal(project.name, term.name);
        });

        // Delete button: remove this terminal config from the project
        subItem.querySelector('.terminal-sub-delete')!.addEventListener('click', async (e) => {
          e.stopPropagation();
          const updated = project.terminals.filter(t => t.name !== term.name);
          await window.api.updateProject(project.name, { terminals: updated });
          projects = await window.api.loadProjects();
          render();
        });

        subList.appendChild(subItem);
      }

      // "Run All" button
      const runAllItem = document.createElement('li');
      runAllItem.className = 'terminal-sub-item run-all';
      runAllItem.innerHTML = `
        <svg class="terminal-sub-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        <span class="terminal-sub-name">Run All</span>
      `;
      runAllItem.addEventListener('click', (e) => {
        e.stopPropagation();
        window.api.openProject(project.name);
      });
      subList.appendChild(runAllItem);

      li.appendChild(subList);
    }

    // Click project row: toggle expand/collapse if has terminals, otherwise open
    const projectRow = li.querySelector('.project-row')!;
    projectRow.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.project-actions')) return;

      if (hasTerminals) {
        // Toggle expand
        if (expandedProjectNames.has(project.name)) {
          expandedProjectNames.delete(project.name);
        } else {
          expandedProjectNames.add(project.name);
          // Refresh running terminals info
          window.api.getRunningTerminals(project.name).then(names => {
            runningTerminalNames.set(project.name, names);
            render();
          });
        }
        render();
      } else {
        // No configured terminals — just open a shell
        const existingGroup = [...tabGroups.values()].find(g => g.projectName === project.name);
        if (existingGroup) {
          if (gitPanelProject) closeGitPanel();
          activateGroup(existingGroup.id);
          return;
        }
        window.api.openProject(project.name);
      }
    });

    li.querySelector('.btn-git')!.addEventListener('click', (e) => {
      e.stopPropagation();
      openGitPanel(project);
    });

    const newTermBtn = li.querySelector('.btn-new-term');
    if (newTermBtn) {
      newTermBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.api.newTerminal(project.name);
      });
    }

    const splitBtn = li.querySelector('.btn-split');
    if (splitBtn) {
      splitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const projectSessions = [...sessions.values()].filter(s => s.projectName === project.name);
        const target = projectSessions.find(s => s.id === focusedSessionId) || projectSessions[0];
        if (target) {
          splitSession(target.id);
        }
      });
    }
    li.querySelector('.btn-edit')!.addEventListener('click', (e) => {
      e.stopPropagation();
      showEditDialog(project);
    });
    li.querySelector('.btn-remove')!.addEventListener('click', (e) => {
      e.stopPropagation();
      showRemoveDialog(project);
    });

    list.appendChild(li);
  });
}

// ---- Dynamic terminal config UI ----

function renderTerminalEntries(
  container: HTMLElement,
  terminals: TerminalConfig[],
  onChange: () => void,
): void {
  container.innerHTML = '';

  terminals.forEach((terminal, index) => {
    const div = document.createElement('div');
    div.className = 'edit-terminal-entry';
    div.innerHTML = `
      <div class="terminal-entry-header">
        <input class="terminal-name-input" value="${esc(terminal.name)}"
               placeholder="Terminal name (e.g. server)">
        <button type="button" class="btn danger btn-remove-terminal">&times;</button>
      </div>
      <textarea class="terminal-commands-input" rows="2"
                placeholder="Commands (one per line)">${esc(terminal.commands.join('\n'))}</textarea>
    `;

    const nameInput = div.querySelector('.terminal-name-input') as HTMLInputElement;
    const cmdsInput = div.querySelector('.terminal-commands-input') as HTMLTextAreaElement;
    const removeBtn = div.querySelector('.btn-remove-terminal') as HTMLButtonElement;

    nameInput.addEventListener('input', () => {
      terminals[index].name = nameInput.value.trim();
    });
    cmdsInput.addEventListener('input', () => {
      terminals[index].commands = cmdsInput.value.trim()
        ? cmdsInput.value.trim().split('\n').map(c => c.trim()).filter(Boolean)
        : [];
    });
    removeBtn.addEventListener('click', () => {
      terminals.splice(index, 1);
      onChange();
    });

    container.appendChild(div);
  });

  if (terminals.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'no-terminals-hint';
    hint.textContent = 'No terminals. Click "+ Terminal" to add one.';
    container.appendChild(hint);
  }
}

function validateTerminals(terminals: TerminalConfig[]): string | null {
  const names = new Set<string>();
  for (const t of terminals) {
    if (!t.name) return 'All terminals must have a name.';
    if (names.has(t.name.toLowerCase())) return `Duplicate terminal name: "${t.name}"`;
    names.add(t.name.toLowerCase());
  }
  return null;
}

// ---- Add Project ----

function rerenderAddTerminals(): void {
  renderTerminalEntries(addTerminalsContainer, addTerminals, rerenderAddTerminals);
}

document.getElementById('btn-add')!.onclick = () => {
  addName.value = '';
  addPath.value = '';
  addError.textContent = '';
  addTerminals = [{ name: '', commands: [] }];
  rerenderAddTerminals();
  addDialog.showModal();
  addName.focus();
};

document.getElementById('btn-browse')!.onclick = async () => {
  const dir = await window.api.selectDirectory();
  if (dir) addPath.value = dir;
};

document.getElementById('btn-add-terminal-new')!.onclick = () => {
  addTerminals.push({ name: '', commands: [] });
  rerenderAddTerminals();
};

document.getElementById('add-submit')!.onclick = async () => {
  const name = addName.value.trim();
  const projPath = addPath.value.trim();

  if (!name || !projPath) {
    addError.textContent = 'Name and path are required.';
    return;
  }

  const terminals = addTerminals.filter(t => t.name || t.commands.length > 0);
  const validationError = validateTerminals(terminals);
  if (validationError) {
    addError.textContent = validationError;
    return;
  }

  try {
    await window.api.addProject({ name, path: projPath, terminals });
    projects = await window.api.loadProjects();
    render();
    addDialog.close();
  } catch (err: unknown) {
    addError.textContent = (err as Error).message || 'Failed to add project.';
  }
};

document.getElementById('add-cancel')!.onclick = () => addDialog.close();
addDialog.addEventListener('cancel', () => addDialog.close());

// ---- Edit Project ----

function showEditDialog(project: Project): void {
  editingProject = project;
  editProjectName.textContent = project.name;
  editTerminals = project.terminals.map(t => ({ name: t.name, commands: [...t.commands] }));
  editError.textContent = '';
  rerenderEditTerminals();
  editDialog.showModal();
}

function rerenderEditTerminals(): void {
  renderTerminalEntries(editTerminalsContainer, editTerminals, rerenderEditTerminals);
}

document.getElementById('btn-add-terminal')!.onclick = () => {
  editTerminals.push({ name: '', commands: [] });
  rerenderEditTerminals();
};

document.getElementById('edit-submit')!.onclick = async () => {
  if (!editingProject) return;

  const terminals = editTerminals.filter(t => t.name || t.commands.length > 0);
  const validationError = validateTerminals(terminals);
  if (validationError) {
    editError.textContent = validationError;
    return;
  }

  try {
    await window.api.updateProject(editingProject.name, { terminals });
    projects = await window.api.loadProjects();
    render();
    editDialog.close();
  } catch (err: unknown) {
    editError.textContent = (err as Error).message || 'Failed to update.';
  }
};

document.getElementById('edit-cancel')!.onclick = () => editDialog.close();
editDialog.addEventListener('cancel', () => editDialog.close());

// ---- Remove Project ----

function showRemoveDialog(project: Project): void {
  removingProject = project;
  removeProjectNameEl.textContent = project.name;
  removeDialog.showModal();
}

document.getElementById('remove-confirm')!.onclick = async () => {
  if (!removingProject) return;
  try {
    await window.api.removeProject(removingProject.name);
    projects = await window.api.loadProjects();
    render();
    removeDialog.close();
  } catch {
    removeDialog.close();
  }
};

document.getElementById('remove-cancel')!.onclick = () => removeDialog.close();
removeDialog.addEventListener('cancel', () => removeDialog.close());

// ---- Keyboard shortcuts ----

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
    e.preventDefault();
    document.getElementById('btn-add')!.click();
  }
  // Cmd+D to split the focused terminal
  if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
    e.preventDefault();
    if (focusedSessionId) {
      splitSession(focusedSessionId);
    }
  }
});

// ---- Git panel ----

function fileDiffKey(repoPath: string, filePath: string): string {
  return `${repoPath}\0${filePath}`;
}

async function openGitPanel(project: Project): Promise<void> {
  gitPanelProject = project;
  gitLoading = true;
  gitRepos = [];
  expandedRepos.clear();
  expandedFileDiffs.clear();
  expandedRepoDiffs.clear();

  terminalEmptyState.hidden = true;

  for (const [, group] of tabGroups) {
    group.element.classList.remove('active');
  }

  renderGitPane();
  renderGitTab();

  try {
    gitRepos = await window.api.scanGitRepos(project.path);
    for (const repo of gitRepos) {
      if (repo.files.length > 0) {
        expandedRepos.add(repo.path);
      }
    }
  } catch {
    gitRepos = [];
  }

  gitLoading = false;
  renderGitPane();
}

function closeGitPanel(): void {
  gitPanelProject = null;
  gitRepos = [];
  gitLoading = false;
  expandedRepos.clear();
  expandedFileDiffs.clear();
  expandedRepoDiffs.clear();

  const gitPane = document.getElementById('git-pane');
  if (gitPane) gitPane.remove();

  renderTerminalTabs();

  if (activeGroupId) {
    activateGroup(activeGroupId);
  } else if (tabGroups.size === 0) {
    terminalEmptyState.hidden = false;
  }
}

async function toggleFileDiff(repoPath: string, filePath: string): Promise<void> {
  const key = fileDiffKey(repoPath, filePath);

  if (expandedFileDiffs.has(key)) {
    expandedFileDiffs.delete(key);
    renderGitPane();
    return;
  }

  expandedFileDiffs.set(key, null); // loading
  renderGitPane();

  try {
    const html = await window.api.getFileDiff(repoPath, filePath);
    expandedFileDiffs.set(key, html || '');
  } catch {
    expandedFileDiffs.set(key, '');
  }

  renderGitPane();
}

async function toggleRepoDiff(repoPath: string): Promise<void> {
  if (expandedRepoDiffs.has(repoPath)) {
    expandedRepoDiffs.delete(repoPath);
    renderGitPane();
    return;
  }

  expandedRepoDiffs.set(repoPath, null); // loading
  renderGitPane();

  try {
    const html = await window.api.getRepoDiff(repoPath);
    expandedRepoDiffs.set(repoPath, html || '');
  } catch {
    expandedRepoDiffs.set(repoPath, '');
  }

  renderGitPane();
}

function renderGitTab(): void {
  terminalTabs.innerHTML = '';

  if (gitPanelProject) {
    const tab = document.createElement('div');
    tab.className = 'terminal-tab active';
    tab.innerHTML = `
      <svg class="tab-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>
      <span class="tab-label">${esc(gitPanelProject.name)}</span>
      <button class="tab-close" title="Close">&times;</button>
    `;

    tab.querySelector('.tab-close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      closeGitPanel();
    });

    terminalTabs.appendChild(tab);
  }

  for (const [groupId, group] of tabGroups) {
    const hasNotification = group.sessionIds.some(sid => notifiedSessionIds.has(sid));
    const tab = document.createElement('div');
    tab.className = 'terminal-tab'
      + (hasNotification ? ' has-notification' : '');

    const splitCount = group.sessionIds.length;
    const label = splitCount > 1
      ? `${group.label} (${splitCount})`
      : group.label;

    tab.innerHTML = `
      ${hasNotification ? '<span class="tab-notification"></span>' : ''}
      <span class="tab-label">${esc(label)}</span>
      <button class="tab-close" title="Close">&times;</button>
    `;

    tab.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.tab-close')) return;
      // Fully clean up git panel state before switching
      gitPanelProject = null;
      gitRepos = [];
      gitLoading = false;
      expandedRepos.clear();
      expandedFileDiffs.clear();
      expandedRepoDiffs.clear();
      const gitPane = document.getElementById('git-pane');
      if (gitPane) gitPane.remove();
      activateGroup(groupId);
    });

    tab.querySelector('.tab-close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      closeGroup(groupId);
    });

    terminalTabs.appendChild(tab);
  }
}

function statusLabel(status: string): { letter: string; cls: string } {
  switch (status) {
    case 'M': return { letter: 'M', cls: 'modified' };
    case 'A': return { letter: 'A', cls: 'added' };
    case 'D': return { letter: 'D', cls: 'deleted' };
    case 'R': return { letter: 'R', cls: 'renamed' };
    case '??': return { letter: 'U', cls: 'untracked' };
    default: return { letter: status || '?', cls: '' };
  }
}

function renderGitPane(): void {
  let gitPane = document.getElementById('git-pane');
  if (!gitPane) {
    gitPane = document.createElement('div');
    gitPane.id = 'git-pane';
    gitPane.className = 'git-pane';
    terminalContainer.appendChild(gitPane);
  }

  if (gitLoading) {
    gitPane.innerHTML = `
      <div class="git-center">
        <div class="git-spinner"></div>
        <span>Scanning repositories...</span>
      </div>
    `;
    return;
  }

  if (gitRepos.length === 0) {
    gitPane.innerHTML = `
      <div class="git-center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3">
          <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>
          <path d="M6 21V9a9 9 0 0 0 9 9"/>
        </svg>
        <p>No git repositories found</p>
      </div>
    `;
    return;
  }

  const totalChanges = gitRepos.reduce((sum, r) => sum + r.files.length, 0);
  const reposWithChanges = gitRepos.filter(r => r.files.length > 0);
  const reposClean = gitRepos.filter(r => r.files.length === 0);

  let html = `
    <div class="git-header-bar">
      <div class="git-header-left">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>
        <span>${gitRepos.length} repo${gitRepos.length !== 1 ? 's' : ''}</span>
        ${totalChanges > 0 ? `<span class="git-header-changes">${totalChanges} changed file${totalChanges !== 1 ? 's' : ''}</span>` : ''}
      </div>
      <button class="git-refresh-btn" id="git-refresh" title="Refresh">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      </button>
    </div>
    <div class="git-repos-scroll">
  `;

  if (reposWithChanges.length > 0) {
    for (const repo of reposWithChanges) {
      html += renderRepoCard(repo);
    }
  }

  if (reposClean.length > 0) {
    html += `<div class="git-section-divider">
      <span>Clean repositories</span>
    </div>`;
    for (const repo of reposClean) {
      html += renderRepoCard(repo);
    }
  }

  html += '</div>';
  gitPane.innerHTML = html;

  // Refresh button
  gitPane.querySelector('#git-refresh')?.addEventListener('click', () => {
    if (gitPanelProject) openGitPanel(gitPanelProject);
  });

  // Expand/collapse repo
  gitPane.querySelectorAll('.git-repo-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.btn-repo-diff')) return;
      const repoPath = (header as HTMLElement).dataset.repoPath!;
      if (expandedRepos.has(repoPath)) {
        expandedRepos.delete(repoPath);
      } else {
        expandedRepos.add(repoPath);
      }
      renderGitPane();
    });
  });

  // File click -> toggle inline diff below
  gitPane.querySelectorAll('.git-file-row').forEach(row => {
    row.addEventListener('click', () => {
      const repoPath = (row as HTMLElement).dataset.repoPath!;
      const filePath = (row as HTMLElement).dataset.filePath!;
      toggleFileDiff(repoPath, filePath);
    });
  });

  // Repo "View All" -> toggle inline diff below file list
  gitPane.querySelectorAll('.btn-repo-diff').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const repoPath = (btn as HTMLElement).dataset.repoPath!;
      toggleRepoDiff(repoPath);
    });
  });
}

function renderRepoCard(repo: GitRepoInfo): string {
  const isExpanded = expandedRepos.has(repo.path);
  const changeCount = repo.files.length;
  const repoDiffState = expandedRepoDiffs.get(repo.path);
  const repoDiffOpen = expandedRepoDiffs.has(repo.path);

  let html = `
    <div class="git-repo-card${isExpanded ? ' expanded' : ''}${changeCount > 0 ? ' has-changes' : ''}">
      <div class="git-repo-header" data-repo-path="${esc(repo.path)}">
        <div class="git-repo-chevron${isExpanded ? ' open' : ''}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <svg class="git-folder-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="git-repo-name">${esc(repo.name || '.')}</span>
        ${changeCount > 0
          ? `<span class="git-change-count">${changeCount}</span>
             <button class="btn-repo-diff${repoDiffOpen ? ' active' : ''}" data-repo-path="${esc(repo.path)}" title="${repoDiffOpen ? 'Hide all diffs' : 'View all changes'}">${repoDiffOpen ? 'Hide All' : 'View All'}</button>`
          : '<span class="git-clean-label">clean</span>'
        }
      </div>
  `;

  if (isExpanded && changeCount > 0) {
    html += '<div class="git-file-list">';
    for (const file of repo.files) {
      const st = statusLabel(file.status);
      const key = fileDiffKey(repo.path, file.file);
      const fileDiffOpen = expandedFileDiffs.has(key);
      const fileDiffState = expandedFileDiffs.get(key);

      html += `
        <div class="git-file-row${fileDiffOpen ? ' active' : ''}" data-repo-path="${esc(repo.path)}" data-file-path="${esc(file.file)}">
          <span class="git-file-status ${st.cls}">${esc(st.letter)}</span>
          <span class="git-file-name">${esc(file.file)}</span>
          <span class="git-file-action">${fileDiffOpen ? 'Hide' : 'Diff'}</span>
        </div>
      `;

      // Inline diff for this file
      if (fileDiffOpen) {
        if (fileDiffState === null) {
          html += '<div class="git-inline-diff"><div class="git-inline-diff-loading"><div class="git-spinner"></div> Loading...</div></div>';
        } else if (fileDiffState) {
          html += `<div class="git-inline-diff">${fileDiffState}</div>`;
        } else {
          html += '<div class="git-inline-diff"><div class="git-inline-diff-empty">No changes</div></div>';
        }
      }
    }
    html += '</div>';
  } else if (isExpanded && changeCount === 0) {
    html += '<div class="git-file-list"><div class="git-no-changes">Working tree clean</div></div>';
  }

  // Inline repo diff ("View All")
  if (repoDiffOpen) {
    if (repoDiffState === null) {
      html += '<div class="git-inline-diff repo-level"><div class="git-inline-diff-loading"><div class="git-spinner"></div> Loading...</div></div>';
    } else if (repoDiffState) {
      html += `<div class="git-inline-diff repo-level">${repoDiffState}</div>`;
    } else {
      html += '<div class="git-inline-diff repo-level"><div class="git-inline-diff-empty">No changes</div></div>';
    }
  }

  html += '</div>';
  return html;
}

// ---- Init ----

async function init(): Promise<void> {
  projects = await window.api.loadProjects();
  activeProjects = await window.api.getActiveProjects();
  render();
}

init();
