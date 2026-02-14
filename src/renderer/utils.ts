import type { PreloadApi } from '../types';

declare global {
  interface Window {
    api: PreloadApi;
  }
}

export function esc(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function initials(name: string): string {
  if (!name || !name.trim()) return '??';
  const parts = name.trim().split(/[\s-_]+/);
  if (parts.length >= 2) {
    return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

export function shortenPath(p: string): string {
  try {
    const home = window.api.getHomedir();
    if (home && p.startsWith(home)) {
      return '~' + p.substring(home.length);
    }
  } catch { /* ignore */ }
  return p;
}

export function statusLabel(status: string): { letter: string; cls: string } {
  switch (status) {
    case 'M': return { letter: 'M', cls: 'modified' };
    case 'A': return { letter: 'A', cls: 'added' };
    case 'D': return { letter: 'D', cls: 'deleted' };
    case 'R': return { letter: 'R', cls: 'renamed' };
    case '??': return { letter: 'U', cls: 'untracked' };
    default: return { letter: status || '?', cls: '' };
  }
}
