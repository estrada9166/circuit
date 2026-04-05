import { SearchAddon, ISearchDecorationOptions } from '@xterm/addon-search';
import { sessions } from './state';
import type { TerminalSession } from './state';

const searchAddons = new Map<string, SearchAddon>();
const searchBars = new Map<string, HTMLDivElement>();
const searchInputs = new Map<string, HTMLInputElement>();
const searchCounts = new Map<string, HTMLSpanElement>();

const DECORATIONS: ISearchDecorationOptions = {
  matchBackground: '#665a00',
  matchBorder: '#665a00',
  matchOverviewRuler: '#665a00',
  activeMatchBackground: '#ffcc00',
  activeMatchBorder: '#ffcc00',
  activeMatchColorOverviewRuler: '#ffcc00',
};

let searchTimer: ReturnType<typeof setTimeout> | null = null;

export function attachSearchAddon(session: TerminalSession): void {
  const addon = new SearchAddon();
  session.terminal.loadAddon(addon);
  searchAddons.set(session.id, addon);
  session.disposables.push(addon);

  addon.onDidChangeResults(({ resultIndex, resultCount }) => {
    const countEl = searchCounts.get(session.id);
    if (!countEl) return;
    if (resultCount === 0) {
      countEl.textContent = 'No results';
    } else if (resultIndex === -1) {
      countEl.textContent = `${resultCount}+ matches`;
    } else {
      countEl.textContent = `${resultIndex + 1} of ${resultCount}`;
    }
  });
}

function createSearchBar(sessionId: string): HTMLDivElement {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const bar = document.createElement('div');
  bar.className = 'terminal-search-bar';
  bar.hidden = true;

  const input = document.createElement('input');
  input.className = 'terminal-search-input';
  input.placeholder = 'Find…';
  input.autocomplete = 'off';
  input.spellcheck = false;

  const count = document.createElement('span');
  count.className = 'terminal-search-count';
  count.textContent = '';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'terminal-search-nav';
  prevBtn.title = 'Previous (Shift+Enter)';
  prevBtn.textContent = '\u2191';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'terminal-search-nav';
  nextBtn.title = 'Next (Enter)';
  nextBtn.textContent = '\u2193';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'terminal-search-nav';
  closeBtn.title = 'Close (Escape)';
  closeBtn.textContent = '\u00d7';

  bar.appendChild(input);
  bar.appendChild(count);
  bar.appendChild(prevBtn);
  bar.appendChild(nextBtn);
  bar.appendChild(closeBtn);

  // Wire events
  const addon = searchAddons.get(sessionId);

  const doSearch = () => {
    if (!addon) return;
    const query = input.value;
    if (!query) {
      addon.clearDecorations();
      count.textContent = '';
      return;
    }
    addon.findNext(query, { incremental: true, decorations: DECORATIONS });
  };

  input.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 150);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeTerminalSearch(sessionId);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!addon || !input.value) return;
      if (e.shiftKey) {
        addon.findPrevious(input.value, { decorations: DECORATIONS });
      } else {
        addon.findNext(input.value, { decorations: DECORATIONS });
      }
    }
  });

  // Prevent keystrokes from reaching the terminal
  bar.addEventListener('keydown', (e) => {
    e.stopPropagation();
  });

  prevBtn.addEventListener('click', () => {
    if (addon && input.value) {
      addon.findPrevious(input.value, { decorations: DECORATIONS });
    }
    input.focus();
  });

  nextBtn.addEventListener('click', () => {
    if (addon && input.value) {
      addon.findNext(input.value, { decorations: DECORATIONS });
    }
    input.focus();
  });

  closeBtn.addEventListener('click', () => {
    closeTerminalSearch(sessionId);
  });

  session.element.appendChild(bar);
  searchBars.set(sessionId, bar);
  searchInputs.set(sessionId, input);
  searchCounts.set(sessionId, count);

  return bar;
}

export function openTerminalSearch(sessionId: string): void {
  let bar = searchBars.get(sessionId);
  if (!bar) {
    bar = createSearchBar(sessionId);
  }
  bar.hidden = false;
  const input = searchInputs.get(sessionId);
  if (input) {
    input.select();
    input.focus();
  }
}

export function closeTerminalSearch(sessionId: string): void {
  const bar = searchBars.get(sessionId);
  if (bar) bar.hidden = true;

  const addon = searchAddons.get(sessionId);
  if (addon) addon.clearDecorations();

  const count = searchCounts.get(sessionId);
  if (count) count.textContent = '';

  const session = sessions.get(sessionId);
  if (session) session.terminal.focus();
}

export function disposeTerminalSearch(sessionId: string): void {
  const bar = searchBars.get(sessionId);
  if (bar) bar.remove();
  searchBars.delete(sessionId);
  searchInputs.delete(sessionId);
  searchCounts.delete(sessionId);
  searchAddons.delete(sessionId);
}
