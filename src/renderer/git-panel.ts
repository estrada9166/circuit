import { html as diff2htmlHtml } from 'diff2html';
import {
  ICON_GIT_TAB,
  ICON_GIT_EMPTY,
  ICON_GIT_HEADER,
  ICON_REFRESH,
  ICON_GIT_CHEVRON,
  ICON_GIT_FOLDER,
} from './icons';
import {
  gitPanelProject,
  gitRepos,
  gitLoading,
  expandedRepos,
  expandedFileDiffs,
  expandedRepoDiffs,
  setGitPanelProject,
  setGitRepos,
  setGitLoading,
  fileDiffKey,
  tabGroups,
  activeGroupId,
} from './state';
import { esc, statusLabel } from './utils';
import type { Project, GitRepoInfo } from '../types';

// ---- DOM refs (set during initGitPanel) ----

let terminalContainer: HTMLElement | null = null;
let terminalEmptyState: HTMLElement | null = null;
let terminalTabs: HTMLElement | null = null;

// ---- Callback pattern to avoid circular deps with terminal-ui.ts ----

let activateGroupFn: ((groupId: string) => void) | null = null;
let renderTerminalTabsFn: (() => void) | null = null;
let closeGroupFn: ((groupId: string) => void) | null = null;

export function setTerminalCallbacks(
  activateGroup: (groupId: string) => void,
  renderTabs: () => void,
  closeGroup: (groupId: string) => void,
): void {
  activateGroupFn = activateGroup;
  renderTerminalTabsFn = renderTabs;
  closeGroupFn = closeGroup;
}

// ---- Init ----

export function initGitPanel(): void {
  terminalContainer = document.getElementById('terminal-container');
  terminalEmptyState = document.getElementById('terminal-empty-state');
  terminalTabs = document.getElementById('terminal-tabs');
}

// ---- Diff rendering (moved from main process to renderer) ----

function renderDiffHtml(diffContent: string): string {
  if (!diffContent.trim()) return '';
  return diff2htmlHtml(diffContent, {
    drawFileList: false,
    matching: 'lines',
    outputFormat: 'line-by-line',
  });
}

// ---- Open / close ----

export async function openGitPanel(project: Project): Promise<void> {
  if (!terminalContainer || !terminalEmptyState) return;

  setGitPanelProject(project);
  setGitLoading(true);
  setGitRepos([]);
  expandedRepos.clear();
  expandedFileDiffs.clear();
  expandedRepoDiffs.clear();

  terminalEmptyState.hidden = true;

  // Hide all terminal panes
  for (const [, group] of tabGroups) {
    group.element.classList.remove('active');
  }

  renderGitPane();
  renderGitTab();

  try {
    const repos = await window.api.scanGitRepos(project.path);
    setGitRepos(repos);
    for (const repo of repos) {
      if (repo.files.length > 0) {
        expandedRepos.add(repo.path);
      }
    }
  } catch {
    setGitRepos([]);
  }

  setGitLoading(false);
  renderGitPane();
}

export function closeGitPanel(): void {
  setGitPanelProject(null);
  setGitRepos([]);
  setGitLoading(false);
  expandedFileDiffs.clear();
  expandedRepoDiffs.clear();

  const gitPane = document.getElementById('git-pane');
  if (gitPane) gitPane.remove();

  // Delegate tab rendering back to terminal-ui
  if (renderTerminalTabsFn) {
    renderTerminalTabsFn();
  }

  // Restore the active terminal group
  if (activeGroupId && activateGroupFn) {
    activateGroupFn(activeGroupId);
  } else if (tabGroups.size === 0 && terminalEmptyState) {
    terminalEmptyState.hidden = false;
  }
}

// ---- Toggle diffs ----

async function toggleFileDiff(repoPath: string, filePath: string): Promise<void> {
  const key = fileDiffKey(repoPath, filePath);

  if (expandedFileDiffs.has(key)) {
    expandedFileDiffs.delete(key);
    renderGitPane();
    return;
  }

  // Mark as loading
  expandedFileDiffs.set(key, null);
  renderGitPane();

  try {
    const rawDiff = await window.api.getFileDiff(repoPath, filePath);
    const html = renderDiffHtml(rawDiff);
    expandedFileDiffs.set(key, html);
  } catch {
    expandedFileDiffs.set(key, '');
  }

  renderGitPane();
}

async function toggleRepoDiff(repoPath: string): Promise<void> {
  if (expandedRepoDiffs.has(repoPath)) {
    expandedRepoDiffs.delete(repoPath);
    renderGitPane();
    return;
  }

  // Mark as loading
  expandedRepoDiffs.set(repoPath, null);
  renderGitPane();

  try {
    const rawDiff = await window.api.getRepoDiff(repoPath);
    const html = renderDiffHtml(rawDiff);
    expandedRepoDiffs.set(repoPath, html);
  } catch {
    expandedRepoDiffs.set(repoPath, '');
  }

  renderGitPane();
}

// ---- Tab bar rendering (git tab + terminal tabs) ----

export function renderGitTab(): void {
  if (!terminalTabs) return;

  terminalTabs.innerHTML = '';
  terminalTabs.setAttribute('role', 'tablist');

  // -- Git tab (active) --
  const project = gitPanelProject;
  if (project) {
    const gitTab = document.createElement('div');
    gitTab.className = 'terminal-tab active';
    gitTab.setAttribute('role', 'tab');
    gitTab.setAttribute('aria-selected', 'true');
    gitTab.setAttribute('tabindex', '0');

    gitTab.innerHTML = `
      ${ICON_GIT_TAB}
      <span class="tab-label">${esc(project.name)}</span>
      <button class="tab-close" title="Close" aria-label="Close git panel">&times;</button>
    `;

    gitTab.querySelector('.tab-close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      closeGitPanel();
    });

    // Keyboard support for close button
    gitTab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        // If the focus is on the close button, close; otherwise treat as click on tab
        if ((e.target as HTMLElement).classList.contains('tab-close')) {
          closeGitPanel();
        }
      }
    });

    terminalTabs.appendChild(gitTab);
  }

  // -- Terminal tabs (inactive, so user can switch back) --
  for (const [groupId, group] of tabGroups) {
    const tab = document.createElement('div');
    tab.className = 'terminal-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('tabindex', '0');

    const splitCount = group.sessionIds.length;
    const label = splitCount > 1
      ? `${group.label} (${splitCount})`
      : group.label;

    tab.innerHTML = `
      <span class="tab-label">${esc(label)}</span>
      <button class="tab-close" title="Close" aria-label="Close tab ${esc(label)}">&times;</button>
    `;

    tab.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.tab-close')) return;
      // Fully clear git state before switching to terminal group
      setGitPanelProject(null);
      setGitRepos([]);
      setGitLoading(false);
      expandedRepos.clear();
      expandedFileDiffs.clear();
      expandedRepoDiffs.clear();
      if (activateGroupFn) activateGroupFn(groupId);
    });

    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if ((e.target as HTMLElement).classList.contains('tab-close')) {
          if (closeGroupFn) closeGroupFn(groupId);
        } else {
          setGitPanelProject(null);
          setGitRepos([]);
          setGitLoading(false);
          expandedRepos.clear();
          expandedFileDiffs.clear();
          expandedRepoDiffs.clear();
          if (activateGroupFn) activateGroupFn(groupId);
        }
      }
    });

    tab.querySelector('.tab-close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (closeGroupFn) closeGroupFn(groupId);
    });

    terminalTabs.appendChild(tab);
  }
}

// ---- Git pane content ----

export function renderGitPane(): void {
  if (!terminalContainer) return;

  let gitPane = document.getElementById('git-pane');
  if (!gitPane) {
    gitPane = document.createElement('div');
    gitPane.id = 'git-pane';
    gitPane.className = 'git-pane';
    terminalContainer.appendChild(gitPane);
  }

  if (gitLoading) {
    gitPane.innerHTML = `
      <div class="git-center">
        <div class="git-spinner"></div>
        <span>Scanning repositories...</span>
      </div>
    `;
    return;
  }

  const repos = gitRepos;

  if (repos.length === 0) {
    gitPane.innerHTML = `
      <div class="git-center">
        ${ICON_GIT_EMPTY}
        <p>No git repositories found</p>
      </div>
    `;
    return;
  }

  const totalChanges = repos.reduce((sum, r) => sum + r.files.length, 0);
  const reposWithChanges = repos.filter(r => r.files.length > 0);
  const reposClean = repos.filter(r => r.files.length === 0);

  let html = `
    <div class="git-header-bar">
      <div class="git-header-left">
        ${ICON_GIT_HEADER}
        <span>${repos.length} repo${repos.length !== 1 ? 's' : ''}</span>
        ${totalChanges > 0
          ? `<span class="git-header-changes">${totalChanges} changed file${totalChanges !== 1 ? 's' : ''}</span>`
          : ''}
      </div>
      <button class="git-refresh-btn" id="git-refresh" title="Refresh"
              aria-label="Refresh git status">
        ${ICON_REFRESH}
      </button>
    </div>
    <div class="git-repos-scroll">
  `;

  if (reposWithChanges.length > 0) {
    for (const repo of reposWithChanges) {
      html += renderRepoCard(repo);
    }
  }

  if (reposClean.length > 0) {
    html += `<div class="git-section-divider">
      <span>Clean repositories</span>
    </div>`;
    for (const repo of reposClean) {
      html += renderRepoCard(repo);
    }
  }

  html += '</div>';
  gitPane.innerHTML = html;

  // ---- Attach event listeners ----

  // Refresh button
  gitPane.querySelector('#git-refresh')?.addEventListener('click', () => {
    const project = gitPanelProject;
    if (project) openGitPanel(project);
  });

  // Expand/collapse repo headers
  gitPane.querySelectorAll<HTMLElement>('.git-repo-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.btn-repo-diff')) return;
      const repoPath = header.dataset.repoPath!;
      if (expandedRepos.has(repoPath)) {
        expandedRepos.delete(repoPath);
      } else {
        expandedRepos.add(repoPath);
      }
      renderGitPane();
    });

    header.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('.btn-repo-diff')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const repoPath = header.dataset.repoPath!;
        if (expandedRepos.has(repoPath)) {
          expandedRepos.delete(repoPath);
        } else {
          expandedRepos.add(repoPath);
        }
        renderGitPane();
      }
    });
  });

  // File rows -> toggle inline diff
  gitPane.querySelectorAll<HTMLElement>('.git-file-row').forEach(row => {
    row.addEventListener('click', () => {
      const repoPath = row.dataset.repoPath!;
      const filePath = row.dataset.filePath!;
      toggleFileDiff(repoPath, filePath);
    });

    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const repoPath = row.dataset.repoPath!;
        const filePath = row.dataset.filePath!;
        toggleFileDiff(repoPath, filePath);
      }
    });
  });

  // Repo "View All" / "Hide All" buttons
  gitPane.querySelectorAll<HTMLElement>('.btn-repo-diff').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const repoPath = btn.dataset.repoPath!;
      toggleRepoDiff(repoPath);
    });
  });
}

// ---- Repo card HTML ----

function renderRepoCard(repo: GitRepoInfo): string {
  const isExpanded = expandedRepos.has(repo.path);
  const changeCount = repo.files.length;
  const repoDiffState = expandedRepoDiffs.get(repo.path);
  const repoDiffOpen = expandedRepoDiffs.has(repo.path);

  let html = `
    <div class="git-repo-card${isExpanded ? ' expanded' : ''}${changeCount > 0 ? ' has-changes' : ''}">
      <div class="git-repo-header"
           data-repo-path="${esc(repo.path)}"
           role="button"
           aria-expanded="${isExpanded}"
           tabindex="0">
        <div class="git-repo-chevron${isExpanded ? ' open' : ''}">
          ${ICON_GIT_CHEVRON}
        </div>
        ${ICON_GIT_FOLDER}
        <span class="git-repo-name">${esc(repo.name || '.')}</span>
        ${changeCount > 0
          ? `<span class="git-change-count">${changeCount}</span>
             <button class="btn-repo-diff${repoDiffOpen ? ' active' : ''}"
                     data-repo-path="${esc(repo.path)}"
                     title="${repoDiffOpen ? 'Hide all diffs' : 'View all changes'}">
               ${repoDiffOpen ? 'Hide All' : 'View All'}
             </button>`
          : '<span class="git-clean-label">clean</span>'
        }
      </div>
  `;

  // File list when expanded
  if (isExpanded && changeCount > 0) {
    html += '<div class="git-file-list">';
    for (const file of repo.files) {
      const st = statusLabel(file.status);
      const key = fileDiffKey(repo.path, file.file);
      const fileDiffOpen = expandedFileDiffs.has(key);
      const fileDiffState = expandedFileDiffs.get(key);

      html += `
        <div class="git-file-row${fileDiffOpen ? ' active' : ''}"
             data-repo-path="${esc(repo.path)}"
             data-file-path="${esc(file.file)}"
             role="button"
             tabindex="0">
          <span class="git-file-status ${st.cls}">${esc(st.letter)}</span>
          <span class="git-file-name">${esc(file.file)}</span>
          <span class="git-file-action">${fileDiffOpen ? 'Hide' : 'Diff'}</span>
        </div>
      `;

      // Inline diff for this file
      if (fileDiffOpen) {
        if (fileDiffState === null) {
          html += `<div class="git-inline-diff">
            <div class="git-inline-diff-loading">
              <div class="git-spinner"></div> Loading...
            </div>
          </div>`;
        } else if (fileDiffState) {
          html += `<div class="git-inline-diff">${fileDiffState}</div>`;
        } else {
          html += `<div class="git-inline-diff">
            <div class="git-inline-diff-empty">No changes</div>
          </div>`;
        }
      }
    }
    html += '</div>';
  } else if (isExpanded && changeCount === 0) {
    html += '<div class="git-file-list"><div class="git-no-changes">Working tree clean</div></div>';
  }

  // Inline repo-level diff ("View All")
  if (repoDiffOpen) {
    if (repoDiffState === null) {
      html += `<div class="git-inline-diff repo-level">
        <div class="git-inline-diff-loading">
          <div class="git-spinner"></div> Loading...
        </div>
      </div>`;
    } else if (repoDiffState) {
      html += `<div class="git-inline-diff repo-level">${repoDiffState}</div>`;
    } else {
      html += `<div class="git-inline-diff repo-level">
        <div class="git-inline-diff-empty">No changes</div>
      </div>`;
    }
  }

  html += '</div>';
  return html;
}
