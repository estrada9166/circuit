import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Project, TerminalConfig, UpdatableProjectFields, SavedCommand } from './types';
import { migrateStoreData } from './migration';

const UPDATABLE_FIELDS = new Set<string>(['path', 'terminals', 'color']);

export class Store {
  projects: Project[] = [];
  commands: SavedCommand[] = [];
  private readonly configPath: string;
  private readonly legacyConfigPath?: string;

  constructor(configPath: string, legacyConfigPath?: string) {
    this.configPath = configPath;
    this.legacyConfigPath = legacyConfigPath;
  }

  load(): Project[] {
    this.importLegacyConfigIfNeeded();

    if (!fs.existsSync(this.configPath)) {
      this.projects = [];
      this.commands = [];
      return this.projects;
    }

    let raw: string;
    try {
      raw = fs.readFileSync(this.configPath, 'utf-8');
    } catch {
      this.projects = [];
      this.commands = [];
      return this.projects;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const backupPath = this.configPath + '.bak';
      try { fs.copyFileSync(this.configPath, backupPath); } catch { /* ignore */ }
      this.projects = [];
      this.commands = [];
      return this.projects;
    }

    const { data, wasMigrated } = migrateStoreData(parsed);
    this.projects = data.projects as Project[];
    this.commands = (data.commands ?? []) as SavedCommand[];
    if (wasMigrated) this._save();
    return this.projects;
  }

  private _save(): void {
    const data = { version: 2, projects: this.projects, commands: this.commands };
    const json = JSON.stringify(data, null, 2) + '\n';

    const dir = path.dirname(this.configPath);
    const tmpName = `.iterm-projects-${crypto.randomBytes(6).toString('hex')}.tmp`;
    const tmpPath = path.join(dir, tmpName);

    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(tmpPath, json, { mode: 0o600 });
      fs.renameSync(tmpPath, this.configPath);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  }

  private importLegacyConfigIfNeeded(): void {
    if (!this.legacyConfigPath) return;
    if (fs.existsSync(this.configPath)) return;
    if (!fs.existsSync(this.legacyConfigPath)) return;

    try {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true, mode: 0o700 });
      fs.copyFileSync(this.legacyConfigPath, this.configPath);
    } catch {
      /* ignore */
    }
  }

  private _validatePath(projPath: string): string {
    const resolved = fs.realpathSync(projPath);
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${projPath}`);
    }
    return resolved;
  }

  addProject({ name, path: projPath, terminals = [], color }: {
    name: string;
    path: string;
    terminals?: TerminalConfig[];
    color?: string;
  }): Project {
    if (!name || typeof name !== 'string') {
      throw new Error('Name is required');
    }
    if (!projPath || typeof projPath !== 'string') {
      throw new Error('Path is required');
    }

    const resolved = this._validatePath(projPath);

    const nameLower = name.toLowerCase();
    if (this.projects.some(p => p.name.toLowerCase() === nameLower)) {
      throw new Error(`Project '${name}' already exists`);
    }

    const project: Project = { name, path: resolved, terminals };
    if (color) project.color = color;
    this.projects.push(project);
    this._save();
    return project;
  }

  removeProject(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new Error('Name is required');
    }
    const idx = this.projects.findIndex(p => p.name === name);
    if (idx === -1) {
      throw new Error(`Project '${name}' not found`);
    }
    this.projects.splice(idx, 1);
    this._save();
  }

  reorderProjects(names: string[]): void {
    const byName = new Map(this.projects.map(p => [p.name, p]));
    const reordered: Project[] = [];
    for (const name of names) {
      const p = byName.get(name);
      if (p) {
        reordered.push(p);
        byName.delete(name);
      }
    }
    // Append any projects not in the names list (safety net)
    for (const p of byName.values()) {
      reordered.push(p);
    }
    this.projects = reordered;
    this._save();
  }

  updateProject(name: string, fields: UpdatableProjectFields): Project {
    if (!name || typeof name !== 'string') {
      throw new Error('Name is required');
    }

    const project = this.projects.find(p => p.name === name);
    if (!project) {
      throw new Error(`Project '${name}' not found`);
    }

    for (const key of Object.keys(fields)) {
      if (!UPDATABLE_FIELDS.has(key)) {
        throw new Error(`Cannot update field: ${key}`);
      }
    }

    // Validate path if being updated (same validation as addProject)
    if (fields.path !== undefined) {
      if (typeof fields.path !== 'string' || !fields.path) {
        throw new Error('Path must be a non-empty string');
      }
      project.path = this._validatePath(fields.path);
    }

    if (fields.terminals !== undefined) {
      if (!Array.isArray(fields.terminals)) {
        throw new Error('Terminals must be an array');
      }
      project.terminals = fields.terminals;
    }

    if (fields.color !== undefined) {
      project.color = fields.color || undefined;
    }

    this._save();
    return project;
  }

  addCommand(cmd: SavedCommand): SavedCommand {
    if (!cmd.name || typeof cmd.name !== 'string') {
      throw new Error('Command name is required');
    }
    if (!cmd.command || typeof cmd.command !== 'string') {
      throw new Error('Command string is required');
    }
    const saved: SavedCommand = { name: cmd.name, command: cmd.command };
    if (cmd.description) saved.description = cmd.description;
    if (cmd.project) saved.project = cmd.project;
    this.commands.push(saved);
    this._save();
    return saved;
  }

  updateCommand(index: number, cmd: SavedCommand): SavedCommand {
    if (index < 0 || index >= this.commands.length) {
      throw new Error(`Command index ${index} out of bounds`);
    }
    if (!cmd.name || typeof cmd.name !== 'string') {
      throw new Error('Command name is required');
    }
    if (!cmd.command || typeof cmd.command !== 'string') {
      throw new Error('Command string is required');
    }
    const saved: SavedCommand = { name: cmd.name, command: cmd.command };
    if (cmd.description) saved.description = cmd.description;
    if (cmd.project) saved.project = cmd.project;
    this.commands[index] = saved;
    this._save();
    return saved;
  }

  removeCommand(index: number): void {
    if (index < 0 || index >= this.commands.length) {
      throw new Error(`Command index ${index} out of bounds`);
    }
    this.commands.splice(index, 1);
    this._save();
  }
}
