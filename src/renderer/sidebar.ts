import { projects, activeProjects, activeGroupId, sessions, tabGroups, focusedSessionId, notifiedSessionIds, collapsedProjectNames, runningTerminalNames, projectBranches } from './state';
import { esc } from './utils';
import type { Project } from '../types';

// ---- Callback types (avoids circular deps) ----

type OpenProjectFn = (project: Project) => void;
type OpenGitPanelFn = (project: Project) => void;
type SplitSessionFn = (sessionId: string) => void;
type ShowEditDialogFn = (project: Project) => void;
type ShowRemoveDialogFn = (project: Project) => void;
type OpenSingleTerminalFn = (projectName: string, terminalName: string, prefill?: boolean) => void;
type NewTerminalFn = (projectName: string) => void;
type CloseGitPanelFn = () => void;
type ActivateGroupFn = (groupId: string) => void;
type FocusSessionFn = (sessionId: string) => void;
type RenderFn = () => void;

type ReorderProjectsFn = (names: string[]) => Promise<void>;

let callbacks: {
  openProject: OpenProjectFn;
  openGitPanel: OpenGitPanelFn;
  splitSession: SplitSessionFn;
  showEditDialog: ShowEditDialogFn;
  showRemoveDialog: ShowRemoveDialogFn;
  openSingleTerminal: OpenSingleTerminalFn;
  newTerminal: NewTerminalFn;
  closeGitPanel: CloseGitPanelFn;
  activateGroup: ActivateGroupFn;
  focusSession: FocusSessionFn;
  render: RenderFn;
  refreshRunningTerminals: (projectName: string) => Promise<void>;
  updateProject: (projectName: string, fields: { terminals: { name: string; commands: string[]; color?: string }[] }) => Promise<void>;
  reorderProjects: ReorderProjectsFn;
} | null = null;

export function setSidebarCallbacks(cbs: typeof callbacks): void {
  callbacks = cbs;
}

// ---- DOM refs ----

let list: HTMLElement;
let emptyState: HTMLElement;

// ---- Drag state ----

let draggedProjectName: string | null = null;

function clearDropIndicators(): void {
  list.querySelectorAll('.drag-over-above, .drag-over-below').forEach(el => {
    el.classList.remove('drag-over-above', 'drag-over-below');
  });
}

// ---- SVG icons ----

const SVG_GIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>';

const SVG_NEW_TERM = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

const SVG_SPLIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>';

const SVG_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

const SVG_REMOVE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

const SVG_CHEVRON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

const SVG_FOLDER_CLOSED = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';

const SVG_FOLDER_OPEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>';

const SVG_TERMINAL = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>';

const SVG_SMALL_PLUS = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

const SVG_SMALL_X = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// ---- Init ----

export function initSidebar(): void {
  list = document.getElementById('project-list')!;
  emptyState = document.getElementById('empty-state')!;

  // List-level keyboard navigation
  list.addEventListener('keydown', (e: KeyboardEvent) => {
    const items = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'));
    if (items.length === 0) return;

    const currentIndex = items.findIndex(el => el === document.activeElement);

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        items[next].focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        items[prev].focus();
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (currentIndex >= 0) {
          items[currentIndex].click();
        }
        break;
      }
    }
  });
}

// ---- Render (full rebuild — simple and correct) ----

export function renderSidebar(): void {
  list.innerHTML = '';
  emptyState.hidden = projects.length > 0;

  // Prune stale state for removed projects
  const projectNames = new Set(projects.map(p => p.name));
  for (const name of collapsedProjectNames) {
    if (!projectNames.has(name)) collapsedProjectNames.delete(name);
  }
  for (const name of runningTerminalNames.keys()) {
    if (!projectNames.has(name)) runningTerminalNames.delete(name);
  }

  // Pre-build session-by-project index to avoid O(n*m) per-project filtering
  const sessionsByProject = new Map<string, typeof sessions extends Map<string, infer V> ? V[] : never>();
  for (const [, session] of sessions) {
    let arr = sessionsByProject.get(session.projectName);
    if (!arr) {
      arr = [];
      sessionsByProject.set(session.projectName, arr);
    }
    arr.push(session);
  }

  projects.forEach(project => {
    const li = document.createElement('li');
    li.className = 'project-item';
    li.setAttribute('role', 'option');
    li.setAttribute('tabindex', '0');
    li.setAttribute('draggable', 'true');
    li.dataset.projectName = project.name;

    const isActive = activeProjects.includes(project.name);
    if (isActive) li.classList.add('active');

    const activeGroup = activeGroupId ? tabGroups.get(activeGroupId) : null;
    if (activeGroup && activeGroup.projectName === project.name) {
      li.classList.add('selected');
    }

    const hasTerminals = project.terminals.length > 0;
    const isExpanded = hasTerminals && !collapsedProjectNames.has(project.name);
    if (isExpanded) li.classList.add('expanded');

    const running = runningTerminalNames.get(project.name) || [];

    // Check if any session for this project has a notification
    const projectSessions = sessionsByProject.get(project.name) || [];
    const hasProjectNotification = projectSessions.some(s => notifiedSessionIds.has(s.id));

    const iconStyle = project.color ? ` style="color: ${esc(project.color)}"` : '';
    const branch = projectBranches.get(project.name);

    li.innerHTML = `
      <div class="project-row">
        <div class="project-icon${hasTerminals ? ' has-terminals' : ''}"${iconStyle}>
          ${isExpanded ? SVG_FOLDER_OPEN : SVG_FOLDER_CLOSED}
          ${hasTerminals ? `<span class="icon-chevron${isExpanded ? ' open' : ''}">${SVG_CHEVRON}</span>` : ''}
        </div>
        <div class="project-details">
          <div class="project-name">${esc(project.name)}</div>
          ${branch ? `<div class="project-meta">${esc(branch)}</div>` : ''}
        </div>
        ${hasProjectNotification ? '<div class="notification-indicator"></div>' : ''}
        ${isActive && !hasProjectNotification ? '<div class="active-indicator"></div>' : ''}
        <div class="project-actions">
          <button class="action-btn btn-git" title="Git Status">${SVG_GIT}</button>
          <button class="action-btn btn-new-term" title="New Terminal">${SVG_NEW_TERM}</button>
          ${isActive ? `<button class="action-btn btn-split" title="Split Pane">${SVG_SPLIT}</button>` : ''}
          <button class="action-btn btn-edit" title="Edit">${SVG_EDIT}</button>
          <button class="action-btn danger btn-remove" title="Remove">${SVG_REMOVE}</button>
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
        const isFocused = isRunning && projectSessions.some(
          s => s.terminalName === term.name && s.id === focusedSessionId
        );
        const subItem = document.createElement('li');
        subItem.className = 'terminal-sub-item'
          + (isRunning ? ' running' : '')
          + (isFocused ? ' focused' : '')
          + (termHasNotification ? ' has-notification' : '');
        subItem.innerHTML = `
          <span class="terminal-sub-icon">${SVG_TERMINAL}</span>
          <span class="terminal-sub-name">${esc(term.name)}</span>
          ${termHasNotification ? '<span class="terminal-sub-notification"></span>' : (isRunning ? '<span class="terminal-sub-running"></span>' : '')}
          <button class="terminal-sub-new" title="Open new tab">${SVG_SMALL_PLUS}</button>
          <button class="terminal-sub-delete" title="Remove terminal">${SVG_SMALL_X}</button>
          <span class="terminal-sub-action">${isRunning ? 'Focus' : 'Run'}</span>
        `;

        // Click row: focus if running (check live sessions), launch if not
        subItem.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.terminal-sub-new')) return;
          if ((e.target as HTMLElement).closest('.terminal-sub-delete')) return;
          e.stopPropagation();
          if (!callbacks) return;
          const liveSession = [...sessions.values()].find(
            s => s.projectName === project.name && s.terminalName === term.name
          );
          if (liveSession) {
            const group = tabGroups.get(liveSession.groupId);
            if (group) {
              callbacks.closeGitPanel();
              callbacks.activateGroup(group.id);
              callbacks.focusSession(liveSession.id);
            }
          } else {
            callbacks.openSingleTerminal(project.name, term.name, false);
          }
        });

        // "+" button: always open a new tab for this terminal
        subItem.querySelector('.terminal-sub-new')!.addEventListener('click', (e) => {
          e.stopPropagation();
          if (callbacks) callbacks.openSingleTerminal(project.name, term.name, false);
        });

        // Delete button: remove this terminal config from the project
        subItem.querySelector('.terminal-sub-delete')!.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!callbacks) return;
          const updated = project.terminals.filter(t => t.name !== term.name);
          callbacks.updateProject(project.name, { terminals: updated });
        });

        subList.appendChild(subItem);
      }

      li.appendChild(subList);
    }

    // Folder icon click: toggle expand/collapse terminal list
    if (hasTerminals) {
      const iconEl = li.querySelector('.project-icon')!;
      iconEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!callbacks) return;
        if (collapsedProjectNames.has(project.name)) {
          collapsedProjectNames.delete(project.name);
          callbacks.refreshRunningTerminals(project.name);
        } else {
          collapsedProjectNames.add(project.name);
        }
        callbacks.render();
      });
    }

    // Click project row: open a plain shell in the project path (no commands)
    const projectRow = li.querySelector('.project-row')!;
    projectRow.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.project-actions')) return;
      if ((e.target as HTMLElement).closest('.project-icon')) return;
      if (!callbacks) return;

      // If terminals already running, focus the first one
      const existingGroup = [...tabGroups.values()].find(g => g.projectName === project.name);
      if (existingGroup) {
        callbacks.closeGitPanel();
        callbacks.activateGroup(existingGroup.id);
        return;
      }

      // Open a plain shell in the project path (no commands)
      callbacks.newTerminal(project.name);
    });

    // Action button handlers
    li.querySelector('.btn-git')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (callbacks) callbacks.openGitPanel(project);
    });

    li.querySelector('.btn-new-term')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (callbacks) callbacks.newTerminal(project.name);
    });

    const splitBtn = li.querySelector('.btn-split');
    if (splitBtn) {
      splitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!callbacks) return;
        const pSessions = projectSessions;
        const target = pSessions.find(s => s.id === focusedSessionId) || pSessions[0];
        if (target) callbacks.splitSession(target.id);
      });
    }

    li.querySelector('.btn-edit')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (callbacks) callbacks.showEditDialog(project);
    });

    li.querySelector('.btn-remove')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (callbacks) callbacks.showRemoveDialog(project);
    });

    // ---- Drag-and-drop handlers ----

    li.addEventListener('dragstart', (e) => {
      draggedProjectName = project.name;
      li.classList.add('dragging');
      e.dataTransfer!.effectAllowed = 'move';
    });

    li.addEventListener('dragend', () => {
      draggedProjectName = null;
      li.classList.remove('dragging');
      clearDropIndicators();
    });

    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedProjectName || draggedProjectName === project.name) return;
      e.dataTransfer!.dropEffect = 'move';
      clearDropIndicators();
      const rect = li.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        li.classList.add('drag-over-above');
      } else {
        li.classList.add('drag-over-below');
      }
    });

    li.addEventListener('dragleave', () => {
      li.classList.remove('drag-over-above', 'drag-over-below');
    });

    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!draggedProjectName || draggedProjectName === project.name || !callbacks) return;

      const rect = li.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const insertBefore = e.clientY < midY;

      // Build new order
      const names = projects.filter(p => p.name !== draggedProjectName).map(p => p.name);
      const targetIdx = names.indexOf(project.name);
      const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
      names.splice(insertIdx, 0, draggedProjectName);

      draggedProjectName = null;
      clearDropIndicators();
      callbacks.reorderProjects(names);
    });

    list.appendChild(li);
  });

  // Temporary terminals section (standalone terminals with no project)
  const temporaryGroups = [...tabGroups.values()].filter(g => g.projectName === '');
  if (temporaryGroups.length > 0) {
    const section = document.createElement('li');
    section.className = 'temporary-section';
    section.innerHTML = `<div class="temporary-header">Temporary</div>`;

    const subList = document.createElement('ul');
    subList.className = 'terminal-sub-list';

    for (const group of temporaryGroups) {
      const isActive = activeGroupId ? tabGroups.get(activeGroupId)?.projectName === '' && group.id === activeGroupId : false;
      const item = document.createElement('li');
      item.className = 'terminal-sub-item' + (isActive ? ' focused' : '');
      item.innerHTML = `
        <span class="terminal-sub-icon">${SVG_TERMINAL}</span>
        <span class="terminal-sub-name">${esc(group.label)}</span>
      `;
      item.addEventListener('click', () => {
        if (!callbacks) return;
        callbacks.closeGitPanel();
        callbacks.activateGroup(group.id);
      });
      subList.appendChild(item);
    }

    section.appendChild(subList);
    list.appendChild(section);
  }
}
