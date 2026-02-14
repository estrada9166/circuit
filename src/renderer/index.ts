import {
  sessions,
  activeGroupId,
  focusedSessionId,
  notifiedSessionIds,
  runningTerminalNames,
  setProjects,
  setActiveProjects,
} from './state';
import { initSidebar, renderSidebar, setSidebarCallbacks } from './sidebar';
import {
  initTerminalUI,
  makeTerminalSession,
  createTabGroup,
  activateGroup,
  fitGroupSessions,
  focusSession,
  removeSession,
  splitSession,
  renderTerminalTabs,
  updateActiveProjects,
  setRenderCallbacks,
  closeGroup,
} from './terminal-ui';
import { initGitPanel, openGitPanel, closeGitPanel, renderGitTab, setTerminalCallbacks } from './git-panel';
import { initDialogs, showEditDialog, showRemoveDialog, setDialogCallbacks } from './dialogs';
import type { PtyCreatedEvent } from '../types';

async function init(): Promise<void> {
  // Initialize all modules (grab DOM refs, wire internal handlers)
  initSidebar();
  initTerminalUI();
  initGitPanel();
  initDialogs();

  // Wire up cross-module callbacks to avoid circular dependencies
  setRenderCallbacks(renderSidebar, renderGitTab);
  setTerminalCallbacks(activateGroup, renderTerminalTabs, closeGroup);
  setSidebarCallbacks({
    openProject: (project) => window.api.openProject(project.name),
    openGitPanel,
    splitSession: (sessionId) => splitSession(sessionId),
    showEditDialog,
    showRemoveDialog,
    openSingleTerminal: (projectName, terminalName) => {
      window.api.openSingleTerminal(projectName, terminalName);
    },
    newTerminal: (projectName) => {
      window.api.newTerminal(projectName);
    },
    closeGitPanel,
    activateGroup,
    focusSession,
    render: renderSidebar,
    refreshRunningTerminals: async (projectName) => {
      const names = await window.api.getRunningTerminals(projectName);
      runningTerminalNames.set(projectName, names);
      renderSidebar();
    },
    updateProject: async (projectName, fields) => {
      await window.api.updateProject(projectName, fields);
      setProjects(await window.api.loadProjects());
      renderSidebar();
    },
    reorderProjects: async (names) => {
      await window.api.reorderProjects(names);
      setProjects(await window.api.loadProjects());
      renderSidebar();
    },
  });
  setDialogCallbacks(renderSidebar);

  // Load initial data in parallel
  const [loadedProjects, active] = await Promise.all([
    window.api.loadProjects(),
    window.api.getActiveProjects(),
  ]);
  setProjects(loadedProjects);
  setActiveProjects(active);
  renderSidebar();

  // Set up IPC listeners with cleanup tracking
  const cleanups: (() => void)[] = [];

  let notificationRenderPending = false;
  cleanups.push(window.api.onTerminalOutput((ptyId: string, data: string) => {
    const session = sessions.get(ptyId);
    if (!session) return;
    session.terminal.write(data);

    // Mark notification for sessions not in the active group
    if (session.groupId !== activeGroupId) {
      notifiedSessionIds.add(session.id);
      if (!notificationRenderPending) {
        notificationRenderPending = true;
        setTimeout(() => {
          notificationRenderPending = false;
          renderTerminalTabs();
          renderSidebar();
        }, 300);
      }
    }
  }));

  cleanups.push(window.api.onTerminalCreated((event: PtyCreatedEvent) => {
    if (sessions.has(event.id)) return;

    const session = makeTerminalSession(event.id, event.projectName, event.terminalName, '');
    sessions.set(event.id, session);

    const group = createTabGroup(session);

    const terminalEmptyState = document.getElementById('terminal-empty-state')!;
    terminalEmptyState.hidden = true;

    activateGroup(group.id);

    requestAnimationFrame(() => {
      session.fitAddon.fit();
      window.api.terminalResize(event.id, session.terminal.cols, session.terminal.rows);
    });
  }));

  cleanups.push(window.api.onTerminalExited((ptyId: string) => {
    removeSession(ptyId);
  }));

  // New Terminal button
  document.getElementById('btn-new-terminal')?.addEventListener('click', () => {
    window.api.openStandaloneTerminal();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl+N: open add project dialog
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      document.getElementById('btn-add')?.click();
    }
    // Cmd/Ctrl+T: open standalone terminal
    if ((e.metaKey || e.ctrlKey) && e.key === 't') {
      e.preventDefault();
      window.api.openStandaloneTerminal();
    }
    // Cmd/Ctrl+D: split the focused terminal
    if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
      e.preventDefault();
      const focused = focusedSessionId;
      if (focused) splitSession(focused);
    }
  });
}

init().catch((err) => {
  console.error('Failed to initialize:', err);
});
