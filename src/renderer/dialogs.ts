import {
  editingProject,
  removingProject,
  editTerminals,
  addTerminals,
  setEditingProject,
  setRemovingProject,
  setEditTerminals,
  setAddTerminals,
  projects,
  setProjects,
} from './state';
import { esc } from './utils';
import { renderSidebar } from './sidebar';
import type { Project, TerminalConfig } from '../types';


// ---- DOM refs (initialized in initDialogs) ----

let addDialog: HTMLDialogElement;
let addName: HTMLInputElement;
let addPath: HTMLInputElement;
let addColorSwatches: HTMLElement;
let addError: HTMLElement;
let addTerminalsContainer: HTMLElement;

let editDialog: HTMLDialogElement;
let editProjectName: HTMLElement;
let editColorSwatches: HTMLElement;
let editError: HTMLElement;
let editTerminalsContainer: HTMLElement;

// Track project color state for add/edit dialogs
let addProjectColor: string | undefined;
let editProjectColor: string | undefined;

let removeDialog: HTMLDialogElement;
let removeProjectNameEl: HTMLElement;

// ---- Color preset swatches ----

const PRESET_COLORS = [
  '#ff453a', '#ff9f0a', '#ffd60a', '#32d74b',
  '#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f',
];

function renderColorSwatches(
  container: HTMLElement,
  selectedColor: string | undefined,
  onSelect: (color: string | undefined) => void,
  small?: boolean,
): void {
  container.innerHTML = '';
  if (small) container.classList.add('color-swatches-sm');

  const colors = [...PRESET_COLORS];
  if (selectedColor && !colors.includes(selectedColor)) {
    colors.push(selectedColor);
  }

  const noneSwatch = document.createElement('button');
  noneSwatch.type = 'button';
  noneSwatch.className = 'color-swatch-none' + (!selectedColor ? ' selected' : '');
  noneSwatch.title = 'No color';
  noneSwatch.addEventListener('click', () => {
    onSelect(undefined);
    renderColorSwatches(container, undefined, onSelect, small);
  });
  container.appendChild(noneSwatch);

  for (const color of colors) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch' + (selectedColor === color ? ' selected' : '');
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener('click', () => {
      const next = selectedColor === color ? undefined : color;
      onSelect(next);
      renderColorSwatches(container, next, onSelect, small);
    });
    container.appendChild(swatch);
  }
}

// ---- Terminal config UI helpers ----

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
      <div class="color-swatches color-swatches-sm terminal-color-swatches"></div>
      <textarea class="terminal-commands-input" rows="2"
                placeholder="Commands (one per line)">${esc(terminal.commands.join('\n'))}</textarea>
    `;

    const swatchContainer = div.querySelector('.terminal-color-swatches') as HTMLElement;
    const nameInput = div.querySelector('.terminal-name-input') as HTMLInputElement;
    const cmdsInput = div.querySelector('.terminal-commands-input') as HTMLTextAreaElement;
    const removeBtn = div.querySelector('.btn-remove-terminal') as HTMLButtonElement;

    renderColorSwatches(swatchContainer, terminal.color, (c) => {
      terminals[index].color = c;
    }, true);
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

// ---- Re-render helpers ----

function rerenderAddTerminals(): void {
  renderTerminalEntries(addTerminalsContainer, addTerminals, rerenderAddTerminals);
}

function rerenderEditTerminals(): void {
  renderTerminalEntries(editTerminalsContainer, editTerminals, rerenderEditTerminals);
}

// ---- Reload and re-render after mutations ----

async function reloadAndRender(): Promise<void> {
  const loaded = await window.api.loadProjects();
  setProjects(loaded);
  renderSidebar();
}

// ---- Exported: initialize all dialogs ----

export function initDialogs(): void {
  // Grab DOM refs
  addDialog = document.getElementById('add-dialog') as HTMLDialogElement;
  addName = document.getElementById('add-name') as HTMLInputElement;
  addPath = document.getElementById('add-path') as HTMLInputElement;
  addColorSwatches = document.getElementById('add-color-swatches')!;
  addError = document.getElementById('add-error')!;
  addTerminalsContainer = document.getElementById('add-terminals-container')!;

  editDialog = document.getElementById('edit-dialog') as HTMLDialogElement;
  editProjectName = document.getElementById('edit-project-name')!;
  editColorSwatches = document.getElementById('edit-color-swatches')!;
  editError = document.getElementById('edit-error')!;
  editTerminalsContainer = document.getElementById('edit-terminals-container')!;

  removeDialog = document.getElementById('remove-dialog') as HTMLDialogElement;
  removeProjectNameEl = document.getElementById('remove-project-name')!;

  // Add aria-labelledby to each dialog pointing to their h2
  addDialog.setAttribute('aria-labelledby', 'add-dialog-title');
  const addH2 = addDialog.querySelector('h2');
  if (addH2) addH2.id = 'add-dialog-title';

  editDialog.setAttribute('aria-labelledby', 'edit-dialog-title');
  const editH2 = editDialog.querySelector('h2');
  if (editH2) editH2.id = 'edit-dialog-title';

  removeDialog.setAttribute('aria-labelledby', 'remove-dialog-title');
  const removeH2 = removeDialog.querySelector('h2');
  if (removeH2) removeH2.id = 'remove-dialog-title';

  // ---- Add dialog button handlers ----

  document.getElementById('btn-add')!.addEventListener('click', () => {
    addName.value = '';
    addPath.value = '';
    addProjectColor = undefined;
    renderColorSwatches(addColorSwatches, undefined, (c) => { addProjectColor = c; });
    addError.textContent = '';
    setAddTerminals([{ name: '', commands: [] }]);
    rerenderAddTerminals();
    addDialog.showModal();
    addName.focus();
  });

  document.getElementById('btn-browse')!.addEventListener('click', async () => {
    const dir = await window.api.selectDirectory();
    if (dir) addPath.value = dir;
  });

  document.getElementById('btn-add-terminal-new')!.addEventListener('click', () => {
    addTerminals.push({ name: '', commands: [] });
    rerenderAddTerminals();
  });

  document.getElementById('add-submit')!.addEventListener('click', async () => {
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
      await window.api.addProject({ name, path: projPath, terminals, color: addProjectColor });
      await reloadAndRender();
      addDialog.close();
    } catch (err: unknown) {
      addError.textContent = (err as Error).message || 'Failed to add project.';
    }
  });

  document.getElementById('add-cancel')!.addEventListener('click', () => addDialog.close());
  addDialog.addEventListener('cancel', () => addDialog.close());

  // ---- Edit dialog button handlers ----

  document.getElementById('btn-add-terminal')!.addEventListener('click', () => {
    editTerminals.push({ name: '', commands: [] });
    rerenderEditTerminals();
  });

  document.getElementById('edit-submit')!.addEventListener('click', async () => {
    if (!editingProject) return;

    const terminals = editTerminals.filter(t => t.name || t.commands.length > 0);
    const validationError = validateTerminals(terminals);
    if (validationError) {
      editError.textContent = validationError;
      return;
    }

    try {
      await window.api.updateProject(editingProject.name, { terminals, color: editProjectColor });
      await reloadAndRender();
      editDialog.close();
    } catch (err: unknown) {
      editError.textContent = (err as Error).message || 'Failed to update.';
    }
  });

  document.getElementById('edit-cancel')!.addEventListener('click', () => editDialog.close());
  editDialog.addEventListener('cancel', () => editDialog.close());

  // ---- Remove dialog button handlers ----

  document.getElementById('remove-confirm')!.addEventListener('click', async () => {
    if (!removingProject) return;
    try {
      await window.api.removeProject(removingProject.name);
      await reloadAndRender();
      removeDialog.close();
    } catch {
      removeDialog.close();
    }
  });

  document.getElementById('remove-cancel')!.addEventListener('click', () => removeDialog.close());
  removeDialog.addEventListener('cancel', () => removeDialog.close());
}

// ---- Exported: show edit dialog for a project ----

export function showEditDialog(project: Project): void {
  setEditingProject(project);
  editProjectName.textContent = project.name;
  setEditTerminals(project.terminals.map(t => ({ name: t.name, commands: [...t.commands], color: t.color })));

  // Initialize project color swatches
  editProjectColor = project.color;
  renderColorSwatches(editColorSwatches, project.color, (c) => { editProjectColor = c; });

  editError.textContent = '';
  rerenderEditTerminals();
  editDialog.showModal();
}

// ---- Exported: show remove confirmation dialog for a project ----

export function showRemoveDialog(project: Project): void {
  setRemovingProject(project);
  removeProjectNameEl.textContent = project.name;
  removeDialog.showModal();
}
