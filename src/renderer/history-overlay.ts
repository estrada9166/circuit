import { ansiToHtml } from './ansi-to-html';

const CHUNK_SIZE = 65536; // 64KB per chunk

interface OverlayState {
  ptyId: string;
  element: HTMLDivElement;
  contentEl: HTMLDivElement;
  totalSize: number;
  loadedOffset: number; // how far from the end we've loaded
  loading: boolean;
  onHide: () => void;
}

let state: OverlayState | null = null;

export function initHistoryOverlay(): void {
  // No global DOM created — overlays are created per-terminal inline
}

export async function showHistoryOverlay(
  ptyId: string,
  terminalWrapper: HTMLDivElement,
  onHide: () => void,
): Promise<void> {
  // Already showing for this terminal
  if (state && state.ptyId === ptyId) return;

  // Clean up any existing overlay
  hideHistoryOverlay();

  const totalSize = await window.api.getLogSize(ptyId);
  if (totalSize === 0) return;

  // Create overlay DOM
  const overlay = document.createElement('div');
  overlay.className = 'history-overlay';

  const searchBar = document.createElement('div');
  searchBar.className = 'history-search-bar';
  searchBar.hidden = true;

  const searchInput = document.createElement('input');
  searchInput.className = 'history-search-input';
  searchInput.placeholder = 'Find in history...';
  searchInput.setAttribute('autocomplete', 'off');
  searchInput.setAttribute('spellcheck', 'false');
  searchBar.appendChild(searchInput);
  overlay.appendChild(searchBar);

  const content = document.createElement('div');
  content.className = 'history-content';
  overlay.appendChild(content);

  const separator = document.createElement('div');
  separator.className = 'history-separator';
  separator.textContent = '— live terminal below —';
  overlay.appendChild(separator);

  terminalWrapper.appendChild(overlay);

  state = {
    ptyId,
    element: overlay,
    contentEl: content,
    totalSize,
    loadedOffset: 0,
    loading: false,
    onHide,
  };

  // Load the last 2 chunks
  await loadMoreChunks(2);

  // Scroll to bottom (closest to live terminal)
  content.scrollTop = content.scrollHeight;

  // Scroll handler: load more on scroll-up, hide on scroll-to-bottom
  content.addEventListener('scroll', onContentScroll);

  // Keyboard: Escape to close, Cmd+F to search
  overlay.addEventListener('keydown', onOverlayKeydown);
  overlay.tabIndex = -1;
  overlay.focus();

  // Search input
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    highlightInContent(content, query);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      searchBar.hidden = true;
      highlightInContent(content, '');
      overlay.focus();
    }
  });
}

export function hideHistoryOverlay(): void {
  if (!state) return;
  const { element, onHide } = state;
  element.remove();
  state = null;
  onHide();
}

async function loadMoreChunks(count: number): Promise<void> {
  if (!state || state.loading) return;
  if (state.loadedOffset >= state.totalSize) return;

  state.loading = true;
  const content = state.contentEl;
  const prevScrollHeight = content.scrollHeight;
  const prevScrollTop = content.scrollTop;

  let html = '';
  for (let i = 0; i < count; i++) {
    const offset = state.loadedOffset;
    if (offset >= state.totalSize) break;

    const chunk = await window.api.readLogChunk(state.ptyId, offset, CHUNK_SIZE);
    if (!chunk) break;

    html = ansiToHtml(chunk) + html;
    state.loadedOffset += CHUNK_SIZE;
  }

  if (html) {
    // Show loading indicator briefly
    const loadingEl = content.querySelector('.history-loading');
    if (loadingEl) loadingEl.remove();

    // Prepend content
    const fragment = document.createElement('div');
    fragment.innerHTML = html;
    content.insertBefore(fragment, content.firstChild);

    // Maintain scroll position
    const heightDelta = content.scrollHeight - prevScrollHeight;
    content.scrollTop = prevScrollTop + heightDelta;
  }

  // Show loading indicator at top if more content available
  if (state.loadedOffset < state.totalSize && !content.querySelector('.history-loading')) {
    const loader = document.createElement('div');
    loader.className = 'history-loading';
    loader.textContent = 'Scroll up for more history...';
    content.insertBefore(loader, content.firstChild);
  }

  state.loading = false;
}

function onContentScroll(): void {
  if (!state) return;
  const content = state.contentEl;

  // Load more when near the top
  if (content.scrollTop < 300) {
    loadMoreChunks(1);
  }

  // Hide overlay when scrolled to the very bottom
  if (content.scrollTop + content.clientHeight >= content.scrollHeight - 5) {
    hideHistoryOverlay();
  }
}

function onOverlayKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    hideHistoryOverlay();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    if (!state) return;
    const searchBar = state.element.querySelector('.history-search-bar') as HTMLDivElement;
    const searchInput = searchBar.querySelector('.history-search-input') as HTMLInputElement;
    searchBar.hidden = false;
    searchInput.focus();
  }
}

function highlightInContent(content: HTMLDivElement, query: string): void {
  // Remove existing highlights
  content.querySelectorAll('.history-highlight').forEach((el) => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent || ''), el);
      parent.normalize();
    }
  });

  if (!query) return;

  // Use TreeWalker for text node search
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const lowerQuery = query.toLowerCase();
  const matches: { node: Text; index: number }[] = [];

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent || '';
    const idx = text.toLowerCase().indexOf(lowerQuery);
    if (idx !== -1) {
      matches.push({ node, index: idx });
    }
  }

  // Highlight first 100 matches
  for (let i = Math.min(matches.length - 1, 99); i >= 0; i--) {
    const { node: textNode, index } = matches[i];
    const range = document.createRange();
    range.setStart(textNode, index);
    range.setEnd(textNode, index + query.length);

    const mark = document.createElement('mark');
    mark.className = 'history-highlight';
    range.surroundContents(mark);
  }

  // Scroll first match into view
  const first = content.querySelector('.history-highlight');
  if (first) first.scrollIntoView({ block: 'center' });
}
