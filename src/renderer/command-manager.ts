import { savedCommands, setSavedCommands, projects } from './state';
import { esc } from './utils';
import { ICON_CMD_EDIT, ICON_CMD_DELETE } from './icons';
import type { SavedCommand } from '../types';

let commandDialog: HTMLDialogElement;
let cmdNameInput: HTMLInputElement;
let cmdDescInput: HTMLInputElement;
let cmdCommandInput: HTMLTextAreaElement;
let cmdProjectSelect: HTMLSelectElement;
let cmdError: HTMLElement;
let cmdDialogTitle: HTMLElement;

let manageOverlay: HTMLDivElement | null = null;
let manageList: HTMLDivElement | null = null;

let editingIndex: number | null = null;

async function reloadCommands(): Promise<void> {
  const cmds = await window.api.loadCommands();
  setSavedCommands(cmds);
}

function populateProjectSelect(): void {
  cmdProjectSelect.innerHTML = '<option value="">Global (all projects)</option>';
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    cmdProjectSelect.appendChild(opt);
  }
}

export function openAddCommandDialog(): void {
  editingIndex = null;
  cmdDialogTitle.textContent = 'Add Command';
  cmdNameInput.value = '';
  cmdDescInput.value = '';
  cmdCommandInput.value = '';
  cmdError.textContent = '';
  populateProjectSelect();
  cmdProjectSelect.value = '';
  commandDialog.showModal();
  cmdNameInput.focus();
}

export function openEditCommandDialog(index: number): void {
  const cmd = savedCommands[index];
  if (!cmd) return;
  editingIndex = index;
  cmdDialogTitle.textContent = 'Edit Command';
  cmdNameInput.value = cmd.name;
  cmdDescInput.value = cmd.description ?? '';
  cmdCommandInput.value = cmd.command;
  cmdError.textContent = '';
  populateProjectSelect();
  cmdProjectSelect.value = cmd.project ?? '';
  commandDialog.showModal();
  cmdNameInput.focus();
}

function renderManageList(): void {
  if (!manageList) return;
  manageList.innerHTML = '';

  if (savedCommands.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'command-manager-empty';
    empty.textContent = 'No saved commands yet.';
    manageList.appendChild(empty);
    return;
  }

  savedCommands.forEach((cmd, index) => {
    const row = document.createElement('div');
    row.className = 'command-manager-item';

    const info = document.createElement('div');
    info.className = 'command-manager-info';
    let infoHtml = `<span class="command-manager-name">${esc(cmd.name)}`;
    if (cmd.project) {
      infoHtml += `<span class="command-palette-badge">${esc(cmd.project)}</span>`;
    }
    infoHtml += `</span>`;
    if (cmd.description) {
      infoHtml += `<span class="command-manager-desc">${esc(cmd.description)}</span>`;
    }
    infoHtml += `<span class="command-manager-cmd">${esc(cmd.command)}</span>`;
    info.innerHTML = infoHtml;

    const actions = document.createElement('div');
    actions.className = 'command-manager-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'cmd-icon-btn';
    editBtn.title = 'Edit';
    editBtn.innerHTML = ICON_CMD_EDIT;
    editBtn.addEventListener('click', () => {
      closeManageCommands();
      openEditCommandDialog(index);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'cmd-icon-btn danger';
    deleteBtn.title = 'Delete';
    deleteBtn.innerHTML = ICON_CMD_DELETE;
    deleteBtn.addEventListener('click', async () => {
      await window.api.removeCommand(index);
      await reloadCommands();
      renderManageList();
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    row.appendChild(info);
    row.appendChild(actions);
    manageList.appendChild(row);
  });
}

export function openManageCommands(): void {
  if (!manageOverlay) return;
  renderManageList();
  manageOverlay.hidden = false;
}

function closeManageCommands(): void {
  if (!manageOverlay) return;
  manageOverlay.hidden = true;
}

export function initCommandManager(): void {
  // ---- Command Add/Edit Dialog ----
  commandDialog = document.getElementById('command-dialog') as HTMLDialogElement;
  cmdDialogTitle = document.getElementById('command-dialog-title')!;
  cmdNameInput = document.getElementById('cmd-name') as HTMLInputElement;
  cmdDescInput = document.getElementById('cmd-desc') as HTMLInputElement;
  cmdCommandInput = document.getElementById('cmd-command') as HTMLTextAreaElement;
  cmdProjectSelect = document.getElementById('cmd-project') as HTMLSelectElement;
  cmdError = document.getElementById('cmd-error')!;

  document.getElementById('cmd-submit')!.addEventListener('click', async () => {
    const name = cmdNameInput.value.trim();
    const command = cmdCommandInput.value.trim();
    const description = cmdDescInput.value.trim() || undefined;
    const project = cmdProjectSelect.value || undefined;

    if (!name || !command) {
      cmdError.textContent = 'Name and command are required.';
      return;
    }

    const cmd: SavedCommand = { name, command };
    if (description) cmd.description = description;
    if (project) cmd.project = project;

    try {
      if (editingIndex !== null) {
        await window.api.updateCommand(editingIndex, cmd);
      } else {
        await window.api.addCommand(cmd);
      }
      await reloadCommands();
      commandDialog.close();
    } catch (err: unknown) {
      cmdError.textContent = (err as Error).message || 'Failed to save command.';
    }
  });

  document.getElementById('cmd-cancel')!.addEventListener('click', () => commandDialog.close());
  commandDialog.addEventListener('cancel', () => commandDialog.close());

  // ---- Manage Commands Overlay ----
  manageOverlay = document.createElement('div');
  manageOverlay.className = 'command-palette-overlay';
  manageOverlay.hidden = true;

  manageOverlay.addEventListener('mousedown', (e) => {
    if (e.target === manageOverlay) closeManageCommands();
  });

  const container = document.createElement('div');
  container.className = 'command-palette command-manager-container';

  const header = document.createElement('div');
  header.className = 'command-manager-header';
  header.innerHTML = `<h3>Manage Commands</h3>`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-sm';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', closeManageCommands);
  header.appendChild(closeBtn);

  manageList = document.createElement('div');
  manageList.className = 'command-palette-list';

  container.appendChild(header);
  container.appendChild(manageList);
  manageOverlay.appendChild(container);
  document.body.appendChild(manageOverlay);

  // Escape key to close manage overlay
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && manageOverlay && !manageOverlay.hidden) {
      closeManageCommands();
    }
  });
}
