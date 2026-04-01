import * as fs from "fs";
import * as path from "path";

export interface SearchResult {
  lineNumber: number;
  text: string;
  offset: number;
}

export class TerminalLogger {
  private logDir: string;
  private streams = new Map<string, fs.WriteStream>();

  constructor(logDir: string) {
    this.logDir = logDir;
    fs.mkdirSync(logDir, { recursive: true });
  }

  startSession(ptyId: string): void {
    const filePath = this.getLogPath(ptyId);
    const stream = fs.createWriteStream(filePath, { flags: "a" });
    this.streams.set(ptyId, stream);
  }

  write(ptyId: string, data: string): void {
    const stream = this.streams.get(ptyId);
    if (stream) {
      stream.write(data);
    }
  }

  endSession(ptyId: string): void {
    const stream = this.streams.get(ptyId);
    if (stream) {
      stream.end();
      this.streams.delete(ptyId);
    }
  }

  endAll(): void {
    for (const [id, stream] of this.streams) {
      stream.end();
      this.streams.delete(id);
    }
  }

  getLogPath(ptyId: string): string {
    return path.join(this.logDir, `${ptyId}.log`);
  }

  getLogSize(ptyId: string): number {
    const filePath = this.getLogPath(ptyId);
    try {
      return fs.statSync(filePath).size;
    } catch {
      return 0;
    }
  }

  /** Read a chunk of bytes from the end of the log file.
   *  offset = 0 means the last `size` bytes, offset = size means the chunk before that, etc. */
  readChunk(ptyId: string, offset: number, size: number): string {
    const filePath = this.getLogPath(ptyId);
    try {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const start = Math.max(0, fileSize - offset - size);
      const end = Math.max(0, fileSize - offset);
      const length = end - start;
      if (length <= 0) return "";

      const buf = Buffer.alloc(length);
      const fd = fs.openSync(filePath, "r");
      try {
        fs.readSync(fd, buf, 0, length, start);
      } finally {
        fs.closeSync(fd);
      }
      return buf.toString("utf-8");
    } catch {
      return "";
    }
  }

  /** Search the log file for lines matching the query (case-insensitive substring). */
  search(ptyId: string, query: string, maxResults: number = 200): SearchResult[] {
    const filePath = this.getLogPath(ptyId);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lowerQuery = query.toLowerCase();
      const results: SearchResult[] = [];
      let offset = 0;

      const lines = content.split("\n");
      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        // Strip ANSI escape sequences for matching
        const plain = lines[i].replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
        if (plain.toLowerCase().includes(lowerQuery)) {
          results.push({
            lineNumber: i + 1,
            text: plain.substring(0, 500),
            offset,
          });
        }
        offset += lines[i].length + 1;
      }

      return results;
    } catch {
      return [];
    }
  }

  /** Delete log files older than maxAgeDays. */
  cleanOldLogs(maxAgeDays: number): void {
    try {
      const entries = fs.readdirSync(this.logDir);
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

      for (const entry of entries) {
        if (!entry.endsWith(".log")) continue;
        const filePath = path.join(this.logDir, entry);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
          }
        } catch {
          /* ignore individual file errors */
        }
      }
    } catch {
      /* ignore if dir doesn't exist yet */
    }
  }
}
