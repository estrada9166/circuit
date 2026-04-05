import * as pty from "node-pty";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { BrowserWindow } from "electron";
import { IPC } from "./types";
import type { TerminalConfig } from "./types";
import type { TerminalLogger } from "./terminal-logger";

/** Environment variables to strip from spawned PTYs */
const FILTERED_ENV_PREFIXES = [
  "ELECTRON_",
  "CHROME_",
  "ORIGINAL_XDG_CURRENT_DESKTOP",
  "GDK_BACKEND",
  "NODE_OPTIONS",
];

function filterEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (FILTERED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)))
      continue;
    env[key] = value;
  }
  return env;
}

interface ManagedPty {
  id: string;
  projectName: string;
  terminalName: string;
  cwd: string;
  process: pty.IPty;
  disposables: { dispose(): void }[];
}

/** Batched output: accumulates data per PTY and flushes on a timer */
interface OutputBuffer {
  data: string;
}

const FLUSH_INTERVAL_MS = 16; // ~1 frame at 60fps
const MAX_TERMINAL_COLS = 500;
const MAX_TERMINAL_ROWS = 200;
const MAX_BUFFER_SIZE = 1024 * 1024 * 5; // 1 MB cap per PTY output buffer
const SIGKILL_TIMEOUT_MS = 2000; // fallback SIGKILL after 2s

export class PtyManager {
  private ptys = new Map<string, ManagedPty>();
  private projectIndex = new Map<string, Set<string>>(); // projectName -> Set<ptyId>
  private window: BrowserWindow | null = null;
  private logger: TerminalLogger | null = null;

  // Output batching
  private outputBuffers = new Map<string, OutputBuffer>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  // Opening mutex
  private openingProjects = new Set<string>();

  setWindow(win: BrowserWindow): void {
    this.window = win;
    // Flush timer starts lazily when the first PTY is created
  }

  setLogger(logger: TerminalLogger): void {
    this.logger = logger;
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(
      () => this.flushOutputBuffers(),
      FLUSH_INTERVAL_MS,
    );
  }

  private stopFlushTimerIfIdle(): void {
    if (this.ptys.size === 0 && this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private flushOutputBuffers(): void {
    if (!this.window || this.window.isDestroyed()) return;
    for (const [ptyId, buffer] of this.outputBuffers) {
      if (buffer.data.length > 0) {
        this.window.webContents.send(IPC.TERMINAL_OUTPUT, ptyId, buffer.data);
        buffer.data = "";
      }
    }
  }

  /** Spawn a new PTY. Returns the session ID. */
  create(
    projectName: string,
    terminalName: string,
    cwd: string,
    initialCommand?: string,
    prefill: boolean = false,
  ): string {
    const id = randomUUID();
    const shell =
      process.env.SHELL ||
      (os.platform() === "win32" ? "powershell.exe" : "/bin/zsh");

    const proc = pty.spawn(shell, ["-l"], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: filterEnv(),
    });

    const disposables: { dispose(): void }[] = [];
    const managed: ManagedPty = {
      id,
      projectName,
      terminalName,
      cwd,
      process: proc,
      disposables,
    };
    this.ptys.set(id, managed);

    // Update project index
    let projectSet = this.projectIndex.get(projectName);
    if (!projectSet) {
      projectSet = new Set();
      this.projectIndex.set(projectName, projectSet);
    }
    projectSet.add(id);

    // Buffer output instead of sending per-chunk
    this.outputBuffers.set(id, { data: "" });

    // Start disk logging for this session
    this.logger?.startSession(id);

    // Start flush timer if not running (lazy start — only when PTYs exist)
    this.startFlushTimer();


    let commandsSent = false;
    let initCmdTimer: ReturnType<typeof setTimeout> | null = null;

    disposables.push(
      proc.onData((data: string) => {
        const buffer = this.outputBuffers.get(id);
        if (buffer) {
          // Cap buffer size to prevent unbounded memory growth
          if (buffer.data.length + data.length > MAX_BUFFER_SIZE) {
            buffer.data = buffer.data.slice(-MAX_BUFFER_SIZE / 2) + data;
          } else {
            buffer.data += data;
          }
        }

        // Log raw output to disk
        this.logger?.write(id, data);

        // Wait for shell prompt before writing initial commands
        if (initialCommand && !commandsSent) {
          // Strip ANSI escape sequences, then check for common prompt endings
          const stripped = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').trimEnd();
          if (stripped.endsWith('$') || stripped.endsWith('%') || stripped.endsWith('>') || stripped.endsWith('#')) {
            commandsSent = true;
            initCmdTimer = setTimeout(() => {
              initCmdTimer = null;
              if (this.ptys.has(id)) {
                proc.write(prefill ? initialCommand : initialCommand + "\r");
              }
            }, 10);
          }
        }
      }),
    );

    disposables.push(
      proc.onExit(() => {
        // Clear pending init command timer
        if (initCmdTimer) {
          clearTimeout(initCmdTimer);
          initCmdTimer = null;
        }
        // Flush any remaining output before removing
        if (this.window && !this.window.isDestroyed()) {
          const buffer = this.outputBuffers.get(id);
          if (buffer && buffer.data.length > 0) {
            this.window.webContents.send(IPC.TERMINAL_OUTPUT, id, buffer.data);
          }
          this.window.webContents.send(IPC.TERMINAL_EXITED, id);
        }
        this.removePty(id);
        this.outputBuffers.delete(id);
        this.logger?.endSession(id);
        this.stopFlushTimerIfIdle();
      }),
    );

    return id;
  }

  private removePty(id: string): void {
    const managed = this.ptys.get(id);
    if (managed) {
      const projectSet = this.projectIndex.get(managed.projectName);
      if (projectSet) {
        projectSet.delete(id);
        if (projectSet.size === 0) {
          this.projectIndex.delete(managed.projectName);
        }
      }
      this.ptys.delete(id);
    }
  }

  /** Open all terminals for a project. Returns array of session IDs. */
  openProject(
    projectName: string,
    cwd: string,
    terminals: TerminalConfig[],
  ): string[] {
    if (this.openingProjects.has(projectName)) {
      return this.getProjectPtyIds(projectName);
    }
    this.openingProjects.add(projectName);

    try {
      if (terminals.length === 0) {
        terminals = [{ name: "shell" }];
      }
      return terminals.map((t) => {
        const termCwd = t.cwd ? path.resolve(cwd, t.cwd) : cwd;
        return this.create(projectName, t.name, termCwd, t.command, true);
      });
    } finally {
      this.openingProjects.delete(projectName);
    }
  }

  /** Split: create a new PTY in the same cwd as an existing one. */
  split(existingPtyId: string): string | null {
    const existing = this.ptys.get(existingPtyId);
    if (!existing) return null;
    return this.create(
      existing.projectName,
      `split-${Date.now()}`,
      existing.cwd,
    );
  }

  /** Spawn a new standalone terminal tab for a project. */
  newTerminal(projectName: string, cwd: string): string {
    return this.create(projectName, "shell", cwd);
  }

  /** Open a single named terminal for a project. */
  openSingleTerminal(
    projectName: string,
    cwd: string,
    terminalName: string,
    command?: string,
    prefill: boolean = false,
  ): string {
    return this.create(projectName, terminalName, cwd, command, prefill);
  }

  /** Get terminal names currently running for a project. */
  getRunningTerminalNames(projectName: string): string[] {
    return [...this.ptys.values()]
      .filter((m) => m.projectName === projectName)
      .map((m) => m.terminalName);
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.process.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    // Validate dimensions to prevent resource exhaustion
    const safeCols = Math.max(1, Math.min(Math.floor(cols), MAX_TERMINAL_COLS));
    const safeRows = Math.max(1, Math.min(Math.floor(rows), MAX_TERMINAL_ROWS));
    this.ptys.get(id)?.process.resize(safeCols, safeRows);
  }

  close(id: string): void {
    const managed = this.ptys.get(id);
    if (managed) {
      // Dispose event listeners first to prevent further data accumulation
      for (const d of managed.disposables) d.dispose();
      managed.disposables.length = 0;

      // Attempt graceful kill, then force-kill after timeout
      const proc = managed.process;
      try {
        proc.kill();
      } catch {
        /* already dead */
      }

      const pid = proc.pid;
      if (pid > 0) {
        setTimeout(() => {
          try {
            process.kill(pid, 0);
            process.kill(pid, "SIGKILL");
          } catch {
            /* already gone */
          }
        }, SIGKILL_TIMEOUT_MS);
      }

      this.removePty(id);
      this.outputBuffers.delete(id);
      this.logger?.endSession(id);
      this.stopFlushTimerIfIdle();
    }
  }

  /** Close all PTYs for a project */
  closeProject(projectName: string): void {
    const ids = this.getProjectPtyIds(projectName);
    for (const id of ids) {
      this.close(id);
    }
  }

  getProjectPtyIds(projectName: string): string[] {
    const projectSet = this.projectIndex.get(projectName);
    return projectSet ? [...projectSet] : [];
  }

  getActiveProjects(): string[] {
    return [...this.projectIndex.keys()];
  }

  hasProject(projectName: string): boolean {
    const projectSet = this.projectIndex.get(projectName);
    return !!projectSet && projectSet.size > 0;
  }

  killAll(): void {
    for (const managed of this.ptys.values()) {
      for (const d of managed.disposables) d.dispose();
      managed.disposables.length = 0;
      try {
        managed.process.kill();
      } catch {
        /* ignore on shutdown */
      }
    }
    this.ptys.clear();
    this.projectIndex.clear();
    this.outputBuffers.clear();
    this.logger?.endAll();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  getSessionInfo(
    id: string,
  ): { projectName: string; terminalName: string } | null {
    const m = this.ptys.get(id);
    return m
      ? { projectName: m.projectName, terminalName: m.terminalName }
      : null;
  }
}
