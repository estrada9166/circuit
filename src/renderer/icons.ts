import {
  GitBranch,
  Pencil,
  X,
  ChevronRight,
  Folder,
  FolderOpen,
  Terminal,
  Plus,
  Columns2,
  Monitor,
  Keyboard,
  RefreshCw,
  Play,
} from 'lucide';

type IconNode = [string, Record<string, string>][];

function renderIcon(
  icon: IconNode,
  size: number,
  strokeWidth: number = 2,
  attrs: string = '',
): string {
  const children = icon
    .map(([tag, a]) => {
      const props = Object.entries(a)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${props}/>`;
    })
    .join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${attrs}>${children}</svg>`;
}

// Sidebar project actions (14px)
export const ICON_GIT = renderIcon(GitBranch, 14);
export const ICON_EDIT = renderIcon(Pencil, 14);
export const ICON_REMOVE = renderIcon(X, 14);

// Chevron for expand/collapse (10px, thicker stroke)
export const ICON_CHEVRON = renderIcon(ChevronRight, 10, 3);

// Folder icons (16px)
export const ICON_FOLDER_CLOSED = renderIcon(Folder, 16);
export const ICON_FOLDER_OPEN = renderIcon(FolderOpen, 16);

// Terminal icon (12px)
export const ICON_TERMINAL = renderIcon(Terminal, 12);

// Small action buttons (10px, thicker stroke)
export const ICON_SMALL_PLUS = renderIcon(Plus, 10, 3);
export const ICON_SMALL_X = renderIcon(X, 10, 3);
export const ICON_SMALL_SPLIT = renderIcon(Columns2, 10, 3);

// Play icon for Run button (12px)
export const ICON_PLAY = renderIcon(Play, 12);

// Git panel icons
export const ICON_GIT_TAB = renderIcon(GitBranch, 12, 2.5, ' class="tab-icon"');
export const ICON_GIT_EMPTY = renderIcon(GitBranch, 40, 1.5, ' style="opacity:0.3"');
export const ICON_GIT_HEADER = renderIcon(GitBranch, 16);
export const ICON_REFRESH = renderIcon(RefreshCw, 14);
export const ICON_GIT_CHEVRON = renderIcon(ChevronRight, 10, 3);
export const ICON_GIT_FOLDER = renderIcon(Folder, 16, 2, ' class="git-folder-icon"');

// index.html replacements
export const ICON_MONITOR = renderIcon(Monitor, 24);
export const ICON_KEYBOARD = renderIcon(Keyboard, 14);
