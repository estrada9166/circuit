/** Lightweight ANSI SGR → HTML converter for the history overlay. */

const COLORS_16: Record<number, string> = {
  0: '#1c1c1e', 1: '#ff453a', 2: '#32d74b', 3: '#ffd60a',
  4: '#0a84ff', 5: '#bf5af2', 6: '#64d2ff', 7: '#f5f5f7',
  // Bright variants
  8: '#8e8e93', 9: '#ff6961', 10: '#4cd964', 11: '#ffe620',
  12: '#409cff', 13: '#da8fff', 14: '#70d7ff', 15: '#ffffff',
};

function color256(n: number): string {
  if (n < 16) return COLORS_16[n] || '#f5f5f7';
  if (n < 232) {
    // 6x6x6 cube
    const idx = n - 16;
    const r = Math.floor(idx / 36);
    const g = Math.floor((idx % 36) / 6);
    const b = idx % 6;
    const toHex = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return `rgb(${toHex(r)},${toHex(g)},${toHex(b)})`;
  }
  // Grayscale
  const level = 8 + (n - 232) * 10;
  return `rgb(${level},${level},${level})`;
}

interface Style {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  reverse: boolean;
}

function defaultStyle(): Style {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, strikethrough: false, reverse: false };
}

function styleToAttrs(s: Style): string {
  const parts: string[] = [];
  let fg = s.fg;
  let bg = s.bg;
  if (s.reverse) { const tmp = fg; fg = bg || '#1c1c1e'; bg = tmp || '#f5f5f7'; }
  if (fg) parts.push(`color:${fg}`);
  if (bg) parts.push(`background:${bg}`);
  if (s.bold) parts.push('font-weight:bold');
  if (s.dim) parts.push('opacity:0.5');
  if (s.italic) parts.push('font-style:italic');
  const decorations: string[] = [];
  if (s.underline) decorations.push('underline');
  if (s.strikethrough) decorations.push('line-through');
  if (decorations.length) parts.push(`text-decoration:${decorations.join(' ')}`);
  return parts.length ? ` style="${parts.join(';')}"` : '';
}

function hasStyle(s: Style): boolean {
  return !!(s.fg || s.bg || s.bold || s.dim || s.italic || s.underline || s.strikethrough || s.reverse);
}

function parseColor(params: number[], i: number): { color: string | null; consumed: number } {
  if (params[i + 1] === 5 && params[i + 2] !== undefined) {
    return { color: color256(params[i + 2]), consumed: 3 };
  }
  if (params[i + 1] === 2 && params[i + 4] !== undefined) {
    return { color: `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`, consumed: 5 };
  }
  return { color: null, consumed: 1 };
}

function applySgr(style: Style, params: number[]): void {
  if (params.length === 0) params = [0];
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p === 0) { Object.assign(style, defaultStyle()); }
    else if (p === 1) style.bold = true;
    else if (p === 2) style.dim = true;
    else if (p === 3) style.italic = true;
    else if (p === 4) style.underline = true;
    else if (p === 7) style.reverse = true;
    else if (p === 9) style.strikethrough = true;
    else if (p === 21 || p === 22) { style.bold = false; style.dim = false; }
    else if (p === 23) style.italic = false;
    else if (p === 24) style.underline = false;
    else if (p === 27) style.reverse = false;
    else if (p === 29) style.strikethrough = false;
    else if (p >= 30 && p <= 37) style.fg = COLORS_16[p - 30] || null;
    else if (p === 38) { const r = parseColor(params, i); style.fg = r.color; i += r.consumed - 1; }
    else if (p === 39) style.fg = null;
    else if (p >= 40 && p <= 47) style.bg = COLORS_16[p - 40] || null;
    else if (p === 48) { const r = parseColor(params, i); style.bg = r.color; i += r.consumed - 1; }
    else if (p === 49) style.bg = null;
    else if (p >= 90 && p <= 97) style.fg = COLORS_16[p - 90 + 8] || null;
    else if (p >= 100 && p <= 107) style.bg = COLORS_16[p - 100 + 8] || null;
  }
}

const ESC_RE = /\x1b\[([0-9;]*)([a-zA-Z])/g;
// Match other non-SGR escape sequences to strip
const OTHER_ESC_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[?!>]?[0-9;]*[a-zA-Z]|\([A-Z0-9]|[78DEHM=>])/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Convert raw terminal output (with ANSI codes) to styled HTML. */
export function ansiToHtml(raw: string): string {
  // First strip non-SGR escape sequences (cursor movement, OSC, etc.)
  let cleaned = raw.replace(OTHER_ESC_RE, '');

  const style = defaultStyle();
  let result = '';
  let lastIndex = 0;

  ESC_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ESC_RE.exec(cleaned)) !== null) {
    // Emit text before this escape
    if (match.index > lastIndex) {
      const text = escapeHtml(cleaned.slice(lastIndex, match.index));
      if (hasStyle(style)) {
        result += `<span${styleToAttrs(style)}>${text}</span>`;
      } else {
        result += text;
      }
    }
    lastIndex = ESC_RE.lastIndex;

    // Only process SGR (ends with 'm')
    if (match[2] === 'm') {
      const params = match[1] ? match[1].split(';').map(Number) : [0];
      applySgr(style, params);
    }
  }

  // Emit remaining text
  if (lastIndex < cleaned.length) {
    const text = escapeHtml(cleaned.slice(lastIndex));
    if (hasStyle(style)) {
      result += `<span${styleToAttrs(style)}>${text}</span>`;
    } else {
      result += text;
    }
  }

  return result;
}
