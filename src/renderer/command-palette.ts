import { tabGroups, activeGroupId, notifiedSessionIds, projects } from './state';
import { esc } from './utils';
import type { Project } from '../types';

let overlay: HTMLDivElement | null = null;
let input: HTMLInputElement | null = null;
let list: HTMLDivElement | null = null;
let activateGroupFn: ((groupId: string) => void) | null = null;
let selectedIndex = 0;

interface PaletteItem {
  type: 'group' | 'project' | 'terminal' | 'action';
  id: string;
  label: string;
  projectName?: string;
  terminalName?: string;
  hasNotification?: boolean;
  isCurrent?: boolean;
  isTemporary?: boolean;
}

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function getOpenGroupForLabel(label: string): { groupId: string; hasNotification: boolean } | null {
  for (const [id, group] of tabGroups) {
    if (group.label === label) {
      const hasNotification = group.sessionIds.some(sid => notifiedSessionIds.has(sid));
      return { groupId: id, hasNotification };
    }
  }
  return null;
}

function getFilteredItems(query: string): PaletteItem[] {
  const items: PaletteItem[] = [];

  for (const project of projects) {
    // Add project entry (opens all terminals)
    const projectLabel = project.name;
    if (!query || fuzzyMatch(query, projectLabel)) {
      items.push({
        type: 'project',
        id: `project:${project.name}`,
        label: projectLabel,
        projectName: project.name,
      });
    }

    // Add individual terminals — if open, link to the group instead
    for (const terminal of project.terminals) {
      const termLabel = `${project.name}: ${terminal.name}`;
      if (!query || fuzzyMatch(query, termLabel)) {
        const openGroup = getOpenGroupForLabel(termLabel);
        if (openGroup) {
          items.push({
            type: 'group',
            id: openGroup.groupId,
            label: termLabel,
            projectName: project.name,
            terminalName: terminal.name,
            hasNotification: openGroup.hasNotification,
            isCurrent: true,
          });
        } else {
          items.push({
            type: 'terminal',
            id: `terminal:${project.name}:${terminal.name}`,
            label: termLabel,
            projectName: project.name,
            terminalName: terminal.name,
          });
        }
      }
    }
  }

  // Temporary terminals (standalone, no project)
  let tempCounter = 0;
  for (const [id, group] of tabGroups) {
    if (group.projectName !== '') continue;
    tempCounter++;
    const label = `Terminal ${tempCounter}`;
    if (!query || fuzzyMatch(query, label) || fuzzyMatch(query, 'temporary')) {
      const hasNotification = group.sessionIds.some(sid => notifiedSessionIds.has(sid));
      items.push({
        type: 'group',
        id,
        label,
        projectName: '',
        hasNotification,
        isCurrent: id === activeGroupId,
        isTemporary: true,
      });
    }
  }

  // Action: New Terminal
  const newTermLabel = 'New Terminal';
  if (!query || fuzzyMatch(query, newTermLabel)) {
    items.push({
      type: 'action',
      id: 'action:new-terminal',
      label: newTermLabel,
    });
  }

  return items;
}

function renderList(): void {
  if (!list || !input) return;
  const query = input.value;
  const items = getFilteredItems(query);

  if (selectedIndex >= items.length) selectedIndex = Math.max(0, items.length - 1);

  list.innerHTML = '';
  let tempSeparatorAdded = false;
  items.forEach((item, i) => {
    if (item.isTemporary && !tempSeparatorAdded) {
      tempSeparatorAdded = true;
      const sep = document.createElement('div');
      sep.className = 'command-palette-separator-group';
      sep.textContent = 'Temporary';
      list!.appendChild(sep);
    }

    const el = document.createElement('div');
    el.className = 'command-palette-item';
    if (item.isCurrent) el.classList.add('current');
    if (i === selectedIndex) el.classList.add('selected');

    let labelHtml: string;
    if (item.isTemporary) {
      labelHtml = `<span class="command-palette-terminal">${esc(item.label)}</span>`;
      if (item.hasNotification) labelHtml += '<span class="command-palette-notification"></span>';
    } else if (item.type === 'group') {
      const colonIdx = item.label.indexOf(':');
      if (colonIdx !== -1) {
        const project = item.label.substring(0, colonIdx);
        const terminal = item.label.substring(colonIdx + 1);
        labelHtml = `<span class="command-palette-project">${esc(project)}</span><span class="command-palette-separator">:</span><span class="command-palette-terminal">${esc(terminal)}</span>`;
      } else {
        labelHtml = `<span class="command-palette-terminal">${esc(item.label)}</span>`;
      }
      if (item.hasNotification) {
        labelHtml += '<span class="command-palette-notification"></span>';
      }
    } else if (item.type === 'project') {
      labelHtml = `<span class="command-palette-project">${esc(item.label)}</span><span class="command-palette-badge">project</span>`;
    } else if (item.type === 'action') {
      labelHtml = `<span class="command-palette-terminal">${esc(item.label)}</span><span class="command-palette-badge">action</span>`;
    } else {
      labelHtml = `<span class="command-palette-project">${esc(item.projectName!)}</span><span class="command-palette-separator">:</span><span class="command-palette-terminal">${esc(item.terminalName!)}</span><span class="command-palette-badge">open</span>`;
    }

    el.innerHTML = labelHtml;

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectItem(item);
    });

    el.addEventListener('mouseenter', () => {
      selectedIndex = i;
      updateSelection();
    });

    list!.appendChild(el);
  });
}

function updateSelection(): void {
  if (!list) return;
  const items = list.querySelectorAll('.command-palette-item');
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === selectedIndex);
  });
  const selected = items[selectedIndex] as HTMLElement | undefined;
  if (selected) {
    selected.scrollIntoView({ block: 'nearest' });
  }
}

function findGroupForProject(projectName: string): string | null {
  for (const [id, group] of tabGroups) {
    if (group.label.startsWith(projectName + ':') || group.label === projectName) {
      return id;
    }
  }
  return null;
}

function selectItem(item: PaletteItem): void {
  closeCommandPalette();
  if (item.type === 'group') {
    if (activateGroupFn) activateGroupFn(item.id);
  } else if (item.type === 'project') {
    const existingGroupId = findGroupForProject(item.projectName!);
    if (existingGroupId && activateGroupFn) {
      activateGroupFn(existingGroupId);
    } else {
      window.api.openProject(item.projectName!);
    }
  } else if (item.type === 'terminal') {
    window.api.openSingleTerminal(item.projectName!, item.terminalName!);
  } else if (item.type === 'action' && item.id === 'action:new-terminal') {
    window.api.openStandaloneTerminal();
  }
}

export function openCommandPalette(): void {
  if (!overlay) return;

  selectedIndex = 0;
  overlay.hidden = false;
  input!.value = '';
  renderList();
  input!.focus();
}

export function closeCommandPalette(): void {
  if (!overlay) return;
  overlay.hidden = true;
  input!.value = '';
}

export function initCommandPalette(activateGroup: (groupId: string) => void): void {
  activateGroupFn = activateGroup;

  overlay = document.createElement('div');
  overlay.className = 'command-palette-overlay';
  overlay.hidden = true;

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeCommandPalette();
  });

  const container = document.createElement('div');
  container.className = 'command-palette';

  input = document.createElement('input');
  input.className = 'command-palette-input';
  input.type = 'text';
  input.placeholder = 'Search terminals and projects...';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  input.addEventListener('input', () => {
    selectedIndex = 0;
    renderList();
  });

  input.addEventListener('keydown', (e) => {
    const items = getFilteredItems(input!.value);
    if (items.length === 0) {
      if (e.key === 'Escape') closeCommandPalette();
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % items.length;
        updateSelection();
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        updateSelection();
        break;
      case 'Enter':
        e.preventDefault();
        selectItem(items[selectedIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        closeCommandPalette();
        break;
    }
  });

  list = document.createElement('div');
  list.className = 'command-palette-list';

  container.appendChild(input);
  container.appendChild(list);
  overlay.appendChild(container);
  document.body.appendChild(overlay);
}
