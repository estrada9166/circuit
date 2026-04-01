import {
  sessions,
  activeGroupId,
  focusedSessionId,
  notifiedSessionIds,
  runningTerminalNames,
  tabGroups,
  projects,
  projectBranches,
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
  splitWithTerminal,
  renderTerminalTabs,
  updateActiveProjects,
  setRenderCallbacks,
  closeGroup,
} from './terminal-ui';
import { initGitPanel, openGitPanel, closeGitPanel, renderGitTab, setTerminalCallbacks } from './git-panel';
import { initDialogs, showEditDialog, showRemoveDialog } from './dialogs';
import { initCommandPalette, openCommandPalette } from './command-palette';
import type { PtyCreatedEvent } from '../types';

async function init(): Promise<void> {
  // Initialize all modules (grab DOM refs, wire internal handlers)
  initSidebar();
  initTerminalUI();
  initGitPanel();
  initDialogs();
  initCommandPalette(activateGroup);

  // Wire up cross-module callbacks to avoid circular dependencies
  setRenderCallbacks(renderSidebar, renderGitTab);
  setTerminalCallbacks(activateGroup, renderTerminalTabs, closeGroup);
  setSidebarCallbacks({
    openProject: (project) => window.api.openProject(project.name),
    openGitPanel,
    splitSession: (sessionId) => splitSession(sessionId),
    splitWithTerminal: (groupId, projectName, terminalName) => splitWithTerminal(groupId, projectName, terminalName),
    showEditDialog,
    showRemoveDialog,
    openSingleTerminal: (projectName, terminalName, prefill) => {
      window.api.openSingleTerminal(projectName, terminalName, prefill);
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

  // Load initial data in parallel
  const [loadedProjects, active] = await Promise.all([
    window.api.loadProjects(),
    window.api.getActiveProjects(),
  ]);
  setProjects(loadedProjects);
  setActiveProjects(active);

  // Pre-populate running terminal state for all projects (they're expanded by default)
  await Promise.all(
    loadedProjects
      .filter(p => p.terminals.length > 0)
      .map(async (p) => {
        const names = await window.api.getRunningTerminals(p.name);
        runningTerminalNames.set(p.name, names);
      })
  );

  // Load git branch names for all projects
  await Promise.all(
    loadedProjects.map(async (p) => {
      const branch = await window.api.getBranch(p.path).catch(() => null);
      if (branch) projectBranches.set(p.name, branch);
    })
  );

  renderSidebar();

  // Poll branch names every 5 seconds and re-render if anything changed
  setInterval(async () => {
    let changed = false;
    await Promise.all(
      projects.map(async (p) => {
        const branch = await window.api.getBranch(p.path).catch(() => null);
        const prev = projectBranches.get(p.name) ?? null;
        if (branch !== prev) {
          if (branch) projectBranches.set(p.name, branch);
          else projectBranches.delete(p.name);
          changed = true;
        }
      })
    );
    if (changed) renderSidebar();
  }, 5000);

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

  cleanups.push(window.api.onOpenCommandPalette(() => {
    openCommandPalette();
  }));


  // New Terminal button
  document.getElementById('btn-new-terminal')?.addEventListener('click', () => {
    window.api.openStandaloneTerminal().catch((err: unknown) => {
      console.error('Failed to open terminal:', err);
    });
  });

  // ── Shortcut popup (shown when shortcuts button is clicked) ──
  const shortcutOverlay = document.createElement('div');
  shortcutOverlay.className = 'shortcut-overlay';
  shortcutOverlay.hidden = true;
  document.body.appendChild(shortcutOverlay);

  const shortcutPopup = document.createElement('div');
  shortcutPopup.className = 'shortcut-popup';
  shortcutPopup.hidden = true;
  shortcutPopup.innerHTML = `
    <div class="shortcut-popup-title">Keyboard Shortcuts</div>
    <div class="shortcut-row"><span class="shortcut-key">\u2318 \u2191/\u2193</span><span class="shortcut-desc">Switch project</span></div>
    <div class="shortcut-row"><span class="shortcut-key">\u2318 \u2190/\u2192</span><span class="shortcut-desc">Switch tab</span></div>
    <div class="shortcut-row"><span class="shortcut-key">\u2318 N</span><span class="shortcut-desc">New project</span></div>
    <div class="shortcut-row"><span class="shortcut-key">\u2318 T</span><span class="shortcut-desc">New terminal</span></div>
    <div class="shortcut-row"><span class="shortcut-key">\u2318 P</span><span class="shortcut-desc">Command palette</span></div>
    <div class="shortcut-row"><span class="shortcut-key">\u2318 D</span><span class="shortcut-desc">Split pane</span></div>
    <div class="shortcut-row"><span class="shortcut-key">\u2318 K</span><span class="shortcut-desc">Clear terminal</span></div>
  `;
  document.body.appendChild(shortcutPopup);

  function showShortcutPopup(): void {
    shortcutPopup.hidden = false;
    shortcutOverlay.hidden = false;
  }

  function hideShortcutPopup(): void {
    shortcutPopup.hidden = true;
    shortcutOverlay.hidden = true;
  }

  // Shortcuts button in sidebar
  document.getElementById('btn-shortcuts')?.addEventListener('click', () => {
    if (!shortcutPopup.hidden) {
      hideShortcutPopup();
    } else {
      showShortcutPopup();
    }
  });

  // Click overlay to dismiss
  shortcutOverlay.addEventListener('click', hideShortcutPopup);

  // Escape to dismiss
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !shortcutPopup.hidden) {
      hideShortcutPopup();
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;

    if (!mod) return;

    // Cmd/Ctrl+N: open add project dialog
    if (e.key === 'n') {
      e.preventDefault();
      document.getElementById('btn-add')?.click();
    }
    // Cmd/Ctrl+T: open standalone terminal
    if (e.key === 't') {
      e.preventDefault();
      window.api.openStandaloneTerminal().catch((err: unknown) => {
        console.error('Failed to open terminal:', err);
      });
    }
    // Cmd/Ctrl+P: open command palette
    if (e.key === 'p') {
      e.preventDefault();
      openCommandPalette();
    }
    // Cmd/Ctrl+D: split the focused terminal
    if (e.key === 'd') {
      e.preventDefault();
      const focused = focusedSessionId;
      if (focused) splitSession(focused);
    }
    // Cmd/Ctrl+K: clear terminal
    if (e.key === 'k') {
      e.preventDefault();
      const focused = focusedSessionId;
      if (focused) {
        const session = sessions.get(focused);
        if (session) session.terminal.clear();
      }
    }
    // Cmd/Ctrl+Left/Right: cycle tabs (only within the active project's visible tabs)
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const activeProjectName = activeGroupId ? tabGroups.get(activeGroupId)?.projectName : undefined;
      const ids = [...tabGroups.entries()]
        .filter(([, g]) => g.projectName === activeProjectName)
        .map(([id]) => id);
      if (ids.length === 0) return;
      const curIdx = activeGroupId ? ids.indexOf(activeGroupId) : -1;
      let nextIdx: number;
      if (e.key === 'ArrowLeft') {
        nextIdx = curIdx <= 0 ? ids.length - 1 : curIdx - 1;
      } else {
        nextIdx = curIdx >= ids.length - 1 ? 0 : curIdx + 1;
      }
      activateGroup(ids[nextIdx]);
    }
    // Cmd/Ctrl+Up/Down: cycle projects
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (projects.length === 0) return;

      // Determine current project index
      let curIdx = -1;
      if (activeGroupId) {
        const activeGroup = tabGroups.get(activeGroupId);
        if (activeGroup) {
          curIdx = projects.findIndex(p => p.name === activeGroup.projectName);
        }
      }

      let nextIdx: number;
      if (e.key === 'ArrowUp') {
        nextIdx = curIdx <= 0 ? projects.length - 1 : curIdx - 1;
      } else {
        nextIdx = curIdx >= projects.length - 1 ? 0 : curIdx + 1;
      }

      const target = projects[nextIdx];

      // If the project has an open tab group, switch to it
      const existingGroup = [...tabGroups.values()].find(g => g.projectName === target.name);
      if (existingGroup) {
        activateGroup(existingGroup.id);
      } else {
        // Open a new terminal for this project
        window.api.newTerminal(target.name);
      }

      // Highlight project in sidebar
      const li = document.querySelector(`[data-project-name="${CSS.escape(target.name)}"]`) as HTMLElement | null;
      if (li) {
        li.focus();
        li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  });

  // Hide popup if window loses focus
  window.addEventListener('blur', hideShortcutPopup);
}

init().catch((err) => {
  console.error('Failed to initialize:', err);
});
