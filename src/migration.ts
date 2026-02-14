import type { Project, LegacyProject, StoredProject, StoreData } from './types';

const CURRENT_VERSION = 2;

export function isLegacyProject(p: StoredProject): p is LegacyProject {
  return 'commands' in p && !('terminals' in p);
}

function migrateLegacyProject(p: LegacyProject): Project {
  return {
    name: p.name,
    path: p.path,
    terminals: p.commands.length > 0
      ? [{ name: 'default', commands: p.commands }]
      : [],
  };
}

/**
 * Takes raw parsed JSON and returns normalized StoreData with version 2 format.
 * Handles: missing version, version 1, version 2, and malformed data.
 */
export function migrateStoreData(raw: unknown): { data: StoreData; wasMigrated: boolean } {
  if (typeof raw !== 'object' || raw === null) {
    return { data: { version: CURRENT_VERSION, projects: [] }, wasMigrated: false };
  }

  const obj = raw as Record<string, unknown>;
  const rawProjects = Array.isArray(obj.projects) ? obj.projects : [];
  const version = typeof obj.version === 'number' ? obj.version : 1;

  let wasMigrated = false;
  const projects: Project[] = [];

  for (const p of rawProjects) {
    if (typeof p !== 'object' || p === null) continue;
    const item = p as Record<string, unknown>;

    if (typeof item.name !== 'string' || typeof item.path !== 'string') continue;
    if (!item.name || !item.path) continue;

    if (version < 2 || isLegacyProject(item as unknown as StoredProject)) {
      const commands = Array.isArray(item.commands)
        ? (item.commands as unknown[]).filter((c): c is string => typeof c === 'string')
        : [];
      projects.push(migrateLegacyProject({ name: item.name as string, path: item.path as string, commands }));
      wasMigrated = true;
    } else {
      const terminals = Array.isArray(item.terminals)
        ? (item.terminals as unknown[])
            .filter((t): t is { name: string; commands: string[] } =>
              typeof t === 'object' && t !== null &&
              typeof (t as Record<string, unknown>).name === 'string' &&
              Array.isArray((t as Record<string, unknown>).commands)
            )
            .map(t => ({
              name: t.name,
              commands: t.commands.filter((c: unknown): c is string => typeof c === 'string'),
            }))
        : [];
      projects.push({ name: item.name as string, path: item.path as string, terminals });
    }
  }

  return {
    data: { version: CURRENT_VERSION, projects },
    wasMigrated,
  };
}
