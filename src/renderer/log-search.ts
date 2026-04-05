import { focusedSessionId } from './state';
import { esc } from './utils';
import type { LogSearchResult } from '../types';

let overlay: HTMLDivElement | null = null;
let input: HTMLInputElement | null = null;
let resultsList: HTMLDivElement | null = null;
let statusEl: HTMLSpanElement | null = null;
let searchTimer: ReturnType<typeof setTimeout> | null = null;

export function initLogSearch(): void {
  overlay = document.createElement('div');
  overlay.className = 'log-search-overlay';
  overlay.hidden = true;

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeLogSearch();
  });

  const container = document.createElement('div');
  container.className = 'log-search-container';

  const header = document.createElement('div');
  header.className = 'log-search-header';

  input = document.createElement('input');
  input.className = 'log-search-input';
  input.type = 'text';
  input.placeholder = 'Search terminal history...';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  statusEl = document.createElement('span');
  statusEl.className = 'log-search-status';

  header.appendChild(input);
  header.appendChild(statusEl);

  resultsList = document.createElement('div');
  resultsList.className = 'log-search-results';

  container.appendChild(header);
  container.appendChild(resultsList);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  input.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 300);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeLogSearch();
    }
  });
}

async function doSearch(): Promise<void> {
  if (!input || !resultsList || !statusEl) return;

  const query = input.value.trim();
  const ptyId = focusedSessionId;

  if (!query || !ptyId) {
    resultsList.innerHTML = '';
    statusEl.textContent = '';
    return;
  }

  statusEl.textContent = 'Searching...';

  try {
    const results: LogSearchResult[] = await window.api.searchLog(ptyId, query);
    renderResults(results, query);
  } catch {
    resultsList.innerHTML = '<div class="log-search-empty">Search failed</div>';
    statusEl.textContent = '';
  }
}

function renderResults(results: LogSearchResult[], query: string): void {
  if (!resultsList || !statusEl) return;

  if (results.length === 0) {
    resultsList.innerHTML = '<div class="log-search-empty">No matches found</div>';
    statusEl.textContent = '0 results';
    return;
  }

  statusEl.textContent = `${results.length}${results.length >= 200 ? '+' : ''} results`;
  resultsList.innerHTML = '';

  const lowerQuery = query.toLowerCase();

  for (const result of results) {
    const row = document.createElement('div');
    row.className = 'log-search-result';

    const lineNum = document.createElement('span');
    lineNum.className = 'log-search-line-num';
    lineNum.textContent = String(result.lineNumber);

    const text = document.createElement('span');
    text.className = 'log-search-text';

    // Highlight the matching substring
    const plainText = result.text;
    const lowerText = plainText.toLowerCase();
    const matchIdx = lowerText.indexOf(lowerQuery);
    if (matchIdx !== -1) {
      const before = plainText.substring(0, matchIdx);
      const match = plainText.substring(matchIdx, matchIdx + query.length);
      const after = plainText.substring(matchIdx + query.length);
      text.innerHTML = `${esc(before)}<mark class="log-search-highlight">${esc(match)}</mark>${esc(after)}`;
    } else {
      text.textContent = plainText;
    }

    row.appendChild(lineNum);
    row.appendChild(text);
    resultsList.appendChild(row);
  }
}

export function openLogSearch(): void {
  if (!overlay || !input) return;
  overlay.hidden = false;
  input.value = '';
  if (resultsList) resultsList.innerHTML = '';
  if (statusEl) statusEl.textContent = '';
  input.focus();
}

export function closeLogSearch(): void {
  if (!overlay) return;
  overlay.hidden = true;
  if (input) input.value = '';
  if (resultsList) resultsList.innerHTML = '';
  if (statusEl) statusEl.textContent = '';
}
