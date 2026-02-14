import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Project, TerminalConfig, UpdatableProjectFields } from './types';
import { migrateStoreData } from './migration';

const CONFIG_PATH = path.join(os.homedir(), '.iterm-projects.json');
const UPDATABLE_FIELDS = new Set<string>(['path', 'terminals', 'color']);

export class Store {
  projects: Project[] = [];

  load(): Project[] {
    if (!fs.existsSync(CONFIG_PATH)) {
      this.projects = [];
      return this.projects;
    }

    let raw: string;
    try {
      raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    } catch {
      this.projects = [];
      return this.projects;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const backupPath = CONFIG_PATH + '.bak';
      try { fs.copyFileSync(CONFIG_PATH, backupPath); } catch { /* ignore */ }
      this.projects = [];
      return this.projects;
    }

    const { data, wasMigrated } = migrateStoreData(parsed);
    this.projects = data.projects as Project[];
    if (wasMigrated) this._save();
    return this.projects;
  }

  private _save(): void {
    const data = { version: 2, projects: this.projects };
    const json = JSON.stringify(data, null, 2) + '\n';

    const dir = path.dirname(CONFIG_PATH);
    const tmpName = `.iterm-projects-${crypto.randomBytes(6).toString('hex')}.tmp`;
    const tmpPath = path.join(dir, tmpName);

    try {
      fs.writeFileSync(tmpPath, json, { mode: 0o600 });
      fs.renameSync(tmpPath, CONFIG_PATH);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
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
}
