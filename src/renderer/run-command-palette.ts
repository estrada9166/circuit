import { savedCommands, tabGroups, activeGroupId, focusedSessionId } from './state';
import { focusSession } from './terminal-ui';
import { esc } from './utils';

let overlay: HTMLDivElement | null = null;
let input: HTMLInputElement | null = null;
let list: HTMLDivElement | null = null;
let selectedIndex = 0;
let openAddCommandFn: (() => void) | null = null;
let openManageCommandsFn: (() => void) | null = null;

interface RunPaletteItem {
  type: 'command' | 'action';
  index?: number;
  name: string;
  description?: string;
  command?: string;
  project?: string;
  actionId?: string;
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

function getActiveProjectName(): string | null {
  if (!activeGroupId) return null;
  const group = tabGroups.get(activeGroupId);
  if (!group || !group.projectName) return null;
  return group.projectName;
}

function getFilteredItems(query: string): RunPaletteItem[] {
  const items: RunPaletteItem[] = [];
  const activeProject = getActiveProjectName();

  for (let i = 0; i < savedCommands.length; i++) {
    const cmd = savedCommands[i];

    // Show global commands and commands matching the active project
    if (cmd.project && cmd.project !== activeProject) continue;

    const searchText = [cmd.name, cmd.description || '', cmd.command].join(' ');
    if (query && !fuzzyMatch(query, searchText)) continue;

    items.push({
      type: 'command',
      index: i,
      name: cmd.name,
      description: cmd.description,
      command: cmd.command,
      project: cmd.project,
    });
  }

  // Action: Add Command
  const addLabel = 'Add Command';
  if (!query || fuzzyMatch(query, addLabel)) {
    items.push({ type: 'action', name: addLabel, actionId: 'add-command' });
  }

  // Action: Manage Commands
  const manageLabel = 'Manage Commands';
  if (!query || fuzzyMatch(query, manageLabel)) {
    items.push({ type: 'action', name: manageLabel, actionId: 'manage-commands' });
  }

  return items;
}

function renderList(): void {
  if (!list || !input) return;
  const query = input.value;
  const items = getFilteredItems(query);

  if (selectedIndex >= items.length) selectedIndex = Math.max(0, items.length - 1);

  list.innerHTML = '';
  items.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'command-palette-item';
    if (i === selectedIndex) el.classList.add('selected');

    let labelHtml: string;
    if (item.type === 'command') {
      let topRow = `<span class="command-palette-terminal">${esc(item.name)}</span>`;
      topRow += `<span class="run-palette-command">${esc(item.command!)}</span>`;
      if (item.project) {
        topRow += `<span class="command-palette-badge">${esc(item.project)}</span>`;
      }
      labelHtml = `<div class="run-palette-top-row">${topRow}</div>`;
      if (item.description) {
        labelHtml += `<div class="run-palette-description">${esc(item.description)}</div>`;
      }
    } else {
      labelHtml = `<div class="run-palette-top-row"><span class="command-palette-terminal">${esc(item.name)}</span><span class="command-palette-badge">action</span></div>`;
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

function selectItem(item: RunPaletteItem): void {
  closeRunCommandPalette();
  if (item.type === 'command' && item.command && focusedSessionId) {
    window.api.terminalInput(focusedSessionId, item.command);
    focusSession(focusedSessionId);
  } else if (item.actionId === 'add-command' && openAddCommandFn) {
    openAddCommandFn();
  } else if (item.actionId === 'manage-commands' && openManageCommandsFn) {
    openManageCommandsFn();
  }
}

export function openRunCommandPalette(): void {
  if (!overlay) return;
  selectedIndex = 0;
  overlay.hidden = false;
  input!.value = '';
  renderList();
  input!.focus();
}

export function closeRunCommandPalette(): void {
  if (!overlay) return;
  overlay.hidden = true;
  input!.value = '';
}

export function initRunCommandPalette(
  openAddCommand: () => void,
  openManageCommands: () => void,
): void {
  openAddCommandFn = openAddCommand;
  openManageCommandsFn = openManageCommands;

  overlay = document.createElement('div');
  overlay.className = 'command-palette-overlay';
  overlay.hidden = true;

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeRunCommandPalette();
  });

  const container = document.createElement('div');
  container.className = 'command-palette';

  input = document.createElement('input');
  input.className = 'command-palette-input';
  input.type = 'text';
  input.placeholder = 'Run a saved command...';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  input.addEventListener('input', () => {
    selectedIndex = 0;
    renderList();
  });

  input.addEventListener('keydown', (e) => {
    const items = getFilteredItems(input!.value);
    if (items.length === 0) {
      if (e.key === 'Escape') closeRunCommandPalette();
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
        closeRunCommandPalette();
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
