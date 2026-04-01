import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import {
  sessions,
  tabGroups,
  activeGroupId,
  focusedSessionId,
  gitPanelProject,
  notifiedSessionIds,
  projects,
  setActiveGroupId,
  setFocusedSessionId,
  setGitPanelProject,
  setActiveProjects,
  nextGroupId,
  TerminalSession,
  TabGroup,
} from './state';
import { esc } from './utils';
import { showHistoryOverlay, hideHistoryOverlay } from './history-overlay';

// ---- Render callback wiring (avoids circular dependency with git-panel) ----

let renderSidebarFn: (() => void) | null = null;
let renderGitTabFn: (() => void) | null = null;

export function setRenderCallbacks(sidebar: () => void, gitTab: () => void): void {
  renderSidebarFn = sidebar;
  renderGitTabFn = gitTab;
}

// ---- DOM refs (initialized in initTerminalUI) ----

let terminalTabs: HTMLElement;
let terminalContainer: HTMLElement;
let terminalEmptyState: HTMLElement;

// ---- Terminal theme ----

const TERMINAL_THEME = {
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
};

const TERMINAL_OPTIONS = {
  theme: TERMINAL_THEME,
  fontSize: 13,
  fontFamily: '"SF Mono", Menlo, monospace',
  cursorBlink: true,
  allowProposedApi: true,
  scrollback: 50000,
};

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- Initialize DOM refs and global event handlers ----

export function initTerminalUI(): void {
  terminalTabs = document.getElementById('terminal-tabs')!;
  terminalContainer = document.getElementById('terminal-container')!;
  terminalEmptyState = document.getElementById('terminal-empty-state')!;

  // Window resize handler with 100ms debounce
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
}

// ---- Terminal session creation ----

export function makeTerminalSession(
  id: string,
  projectName: string,
  terminalName: string,
  groupId: string,
): TerminalSession {
  const terminal = new Terminal(TERMINAL_OPTIONS);

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon((event, uri) => {
    if (event.metaKey) {
      window.api.openExternal(uri);
    }
  }));

  const wrapper = document.createElement('div');
  wrapper.className = 'split-terminal';
  wrapper.dataset.ptyId = id;

  // Close button for this pane (keyboard accessible)
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pane-close';
  closeBtn.title = 'Close pane';
  closeBtn.setAttribute('aria-label', `Close pane ${terminalName}`);
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.api.terminalClose(id);
    removeSession(id);
  });
  closeBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      window.api.terminalClose(id);
      removeSession(id);
    }
  });
  wrapper.appendChild(closeBtn);

  terminal.open(wrapper);

  // Intercept Shift+Enter so it inserts a literal newline in the shell's editing buffer.
  // Sends Ctrl+V (quoted-insert) + LF so bash/zsh insert a newline instead of executing.
  terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    if (event.key === 'Enter' && event.shiftKey) {
      if (event.type === 'keydown') {
        window.api.terminalInput(id, '\x16\x0a');
      }
      return false; // prevent xterm from processing any Shift+Enter event
    }
    // Let Cmd/Ctrl shortcuts bubble up to the document handler
    if ((event.metaKey || event.ctrlKey) && ['n', 't', 'p', 'd', 'k', 'f', 'F', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      return false;
    }
    return true;
  });

  // Track disposables for cleanup
  const disposables: { dispose(): void }[] = [];

  // Forward keystrokes to PTY
  const dataDisposable = terminal.onData((data: string) => {
    window.api.terminalInput(id, data);
  });
  disposables.push(dataDisposable);

  // Notify PTY of resize
  const resizeDisposable = terminal.onResize(({ cols, rows }) => {
    window.api.terminalResize(id, cols, rows);
  });
  disposables.push(resizeDisposable);

  // Scroll-to-top: show history overlay with disk-backed log
  const scrollDisposable = terminal.onScroll(() => {
    if (terminal.buffer.active.viewportY === 0) {
      showHistoryOverlay(id, wrapper, () => {
        terminal.focus();
      });
    }
  });
  disposables.push(scrollDisposable);

  // Click to focus this pane
  wrapper.addEventListener('mousedown', () => {
    focusSession(id);
  });

  return {
    id,
    projectName,
    terminalName,
    terminal,
    fitAddon,
    element: wrapper,
    groupId,
    disposables,
  };
}

// ---- Tab group management ----

export function createTabGroup(session: TerminalSession): TabGroup {
  const gid = nextGroupId();

  const pane = document.createElement('div');
  pane.className = 'terminal-pane';
  pane.dataset.groupId = gid;
  pane.appendChild(session.element);

  terminalContainer.appendChild(pane);

  // Look up the project color
  const project = projects.find(p => p.name === session.projectName);

  const group: TabGroup = {
    id: gid,
    projectName: session.projectName,
    label: session.projectName ? `${session.projectName}: ${session.terminalName}` : `Terminal ${[...tabGroups.values()].filter(g => g.projectName === '').length + 1}`,
    sessionIds: [session.id],
    element: pane,
    color: project?.color,
  };

  session.groupId = gid;
  tabGroups.set(gid, group);
  return group;
}

const pendingFitGroupIds = new Set<string>();

export function fitGroupSessions(group: TabGroup): void {
  // Deduplicate: only one RAF per group at a time
  if (pendingFitGroupIds.has(group.id)) return;
  pendingFitGroupIds.add(group.id);
  requestAnimationFrame(() => {
    pendingFitGroupIds.delete(group.id);
    for (const sid of group.sessionIds) {
      const s = sessions.get(sid);
      if (s) {
        s.fitAddon.fit();
        window.api.terminalResize(sid, s.terminal.cols, s.terminal.rows);
      }
    }
  });
}

export function activateGroup(groupId: string): void {
  setActiveGroupId(groupId);

  // Fully clear git panel state so renderTerminalTabs renders terminal tabs
  if (gitPanelProject) {
    setGitPanelProject(null);
  }
  const gitPane = document.getElementById('git-pane');
  if (gitPane) gitPane.remove();

  for (const [gid, group] of tabGroups) {
    if (gid === groupId) {
      group.element.classList.add('active');
      fitGroupSessions(group);

      // Clear notifications for sessions in this group
      for (const sid of group.sessionIds) {
        notifiedSessionIds.delete(sid);
      }

      // Focus the previously focused session in this group, or the first one
      const toFocus =
        focusedSessionId && group.sessionIds.includes(focusedSessionId)
          ? focusedSessionId
          : group.sessionIds[0];
      if (toFocus) focusSession(toFocus);
    } else {
      group.element.classList.remove('active');
    }
  }

  renderTerminalTabs();
  if (renderSidebarFn) renderSidebarFn();
}

export function focusSession(sessionId: string): void {
  setFocusedSessionId(sessionId);

  for (const [, session] of sessions) {
    session.element.classList.toggle('focused', session.id === sessionId);
  }

  const session = sessions.get(sessionId);
  if (session) {
    session.terminal.focus();
  }
}

// ---- Close / remove ----

export function closeGroup(groupId: string): void {
  const group = tabGroups.get(groupId);
  if (!group) return;

  // Dispose all sessions in the group
  for (const sid of [...group.sessionIds]) {
    window.api.terminalClose(sid);
    const session = sessions.get(sid);
    if (session) {
      for (const d of session.disposables) d.dispose();
      session.terminal.dispose();
      sessions.delete(sid);
    }
    // Clean up stale notification state
    notifiedSessionIds.delete(sid);
  }

  group.element.remove();
  tabGroups.delete(groupId);

  // Switch to next available group (activateGroup already calls renderTerminalTabs)
  if (activeGroupId === groupId) {
    const remaining = [...tabGroups.keys()];
    const nextId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    setActiveGroupId(nextId);
    if (nextId) {
      activateGroup(nextId);
    } else {
      setFocusedSessionId(null);
      renderTerminalTabs();
    }
  } else {
    renderTerminalTabs();
  }

  if (tabGroups.size === 0) {
    terminalEmptyState.hidden = false;
  }

  updateActiveProjects();
}

export function removeSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;

  // Dispose tracked event listeners
  for (const d of session.disposables) d.dispose();
  session.terminal.dispose();

  // Clean up stale notification state
  notifiedSessionIds.delete(id);

  const group = tabGroups.get(session.groupId);
  if (group) {
    const idx = group.sessionIds.indexOf(id);
    if (idx !== -1) {
      group.sessionIds.splice(idx, 1);

      // Remove the element and its adjacent split divider
      const prev = session.element.previousElementSibling;
      const next = session.element.nextElementSibling;
      if (prev && prev.classList.contains('split-divider')) {
        prev.remove();
      } else if (next && next.classList.contains('split-divider')) {
        next.remove();
      }
      session.element.remove();

      if (group.sessionIds.length === 0) {
        // Group is now empty -- remove it
        group.element.remove();
        tabGroups.delete(group.id);

        if (activeGroupId === group.id) {
          const remaining = [...tabGroups.keys()];
          const nextId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
          setActiveGroupId(nextId);
          if (nextId) {
            activateGroup(nextId);
          } else {
            setFocusedSessionId(null);
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

export async function splitSession(sessionId: string): Promise<void> {
  const existing = sessions.get(sessionId);
  if (!existing) return;

  const result = await window.api.splitPane(sessionId);
  if (!result) return;

  const group = tabGroups.get(existing.groupId);
  if (!group) return;

  // Create new session and add to the same group
  const newSession = makeTerminalSession(
    result.id,
    result.projectName,
    result.terminalName,
    group.id,
  );
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

export async function splitWithTerminal(groupId: string, projectName: string, terminalName: string): Promise<void> {
  const group = tabGroups.get(groupId);
  if (!group) return;

  const result = await window.api.splitWithTerminal(projectName, terminalName);
  if (!result) return;

  const newSession = makeTerminalSession(
    result.id,
    result.projectName,
    result.terminalName,
    group.id,
  );
  sessions.set(result.id, newSession);

  const divider = document.createElement('div');
  divider.className = 'split-divider';
  group.element.appendChild(divider);
  group.element.appendChild(newSession.element);

  group.sessionIds.push(result.id);

  fitGroupSessions(group);
  focusSession(result.id);

  renderTerminalTabs();
  updateActiveProjects();
}

// ---- Tab drag-and-drop state ----

let draggedGroupId: string | null = null;

function clearTabDropIndicators(): void {
  terminalTabs.querySelectorAll('.drag-over-left, .drag-over-right').forEach(el => {
    el.classList.remove('drag-over-left', 'drag-over-right');
  });
}

function reorderTabGroups(orderedIds: string[]): void {
  const entries = new Map(tabGroups);
  tabGroups.clear();
  for (const id of orderedIds) {
    const group = entries.get(id);
    if (group) tabGroups.set(id, group);
  }
}

// ---- Tab bar rendering ----

export function renderTerminalTabs(): void {
  // If git panel is active, delegate to the git tab renderer
  if (gitPanelProject) {
    if (renderGitTabFn) renderGitTabFn();
    return;
  }

  terminalTabs.innerHTML = '';
  terminalTabs.setAttribute('role', 'tablist');

  const activeProjectName = activeGroupId ? tabGroups.get(activeGroupId)?.projectName : undefined;
  const groupEntries = [...tabGroups.entries()].filter(([, g]) => g.projectName === activeProjectName);

  for (const [groupId, group] of groupEntries) {
    const isActive = groupId === activeGroupId;

    const tab = document.createElement('div');
    tab.className = 'terminal-tab' + (isActive ? ' active' : '');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(isActive));
    tab.setAttribute('tabindex', isActive ? '0' : '-1');
    tab.setAttribute('draggable', 'true');

    if (group.color) {
      tab.style.borderLeft = `3px solid ${group.color}`;
      if (isActive) {
        tab.style.background = hexToRgba(group.color, 0.12);
      }
    }

    const splitCount = group.sessionIds.length;
    const label =
      splitCount > 1 ? `${group.label} (${splitCount})` : group.label;

    const hasNotification = group.sessionIds.some(sid => notifiedSessionIds.has(sid));
    if (hasNotification) tab.classList.add('has-notification');

    tab.innerHTML = `
      <span class="tab-label">${esc(label)}</span>
      ${hasNotification ? '<span class="tab-notification"></span>' : ''}
      <button class="tab-close" title="Close" aria-label="Close ${esc(label)}" tabindex="0">&times;</button>
    `;

    // Activate tab on click
    tab.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.tab-close')) return;
      activateGroup(groupId);
    });

    // Activate tab on Enter key
    tab.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('.tab-close')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        activateGroup(groupId);
      }
    });

    // Close button handlers
    const closeBtn = tab.querySelector('.tab-close') as HTMLElement;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeGroup(groupId);
    });
    closeBtn.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        closeGroup(groupId);
      }
    });

    // ---- Tab drag-and-drop handlers ----

    tab.addEventListener('dragstart', (e) => {
      draggedGroupId = groupId;
      tab.classList.add('dragging');
      e.dataTransfer!.effectAllowed = 'move';
    });

    tab.addEventListener('dragend', () => {
      draggedGroupId = null;
      tab.classList.remove('dragging');
      clearTabDropIndicators();
    });

    tab.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedGroupId || draggedGroupId === groupId) return;
      e.dataTransfer!.dropEffect = 'move';
      clearTabDropIndicators();
      const rect = tab.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (e.clientX < midX) {
        tab.classList.add('drag-over-left');
      } else {
        tab.classList.add('drag-over-right');
      }
    });

    tab.addEventListener('dragleave', () => {
      tab.classList.remove('drag-over-left', 'drag-over-right');
    });

    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!draggedGroupId || draggedGroupId === groupId) return;

      const rect = tab.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const insertBefore = e.clientX < midX;

      const ids = [...tabGroups.keys()].filter(id => id !== draggedGroupId);
      const targetIdx = ids.indexOf(groupId);
      const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
      ids.splice(insertIdx, 0, draggedGroupId);

      draggedGroupId = null;
      clearTabDropIndicators();
      reorderTabGroups(ids);
      renderTerminalTabs();
    });

    terminalTabs.appendChild(tab);
  }
}

// ---- Active project tracking ----

export function updateActiveProjects(): void {
  // Derive active projects locally from the sessions Map instead of IPC round-trip
  const projectNames = new Set<string>();
  for (const [, session] of sessions) {
    projectNames.add(session.projectName);
  }

  setActiveProjects([...projectNames]);

  // Trigger sidebar re-render
  if (renderSidebarFn) renderSidebarFn();
}
