import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { GitFileInfo, GitRepoInfo } from './types';

const execFileAsync = promisify(execFile);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'vendor', '__pycache__', '.venv', 'venv', '.cache',
]);

/**
 * Validates that a target path is contained within the allowed root.
 * Prevents path traversal attacks.
 */
function assertPathWithin(target: string, root: string): void {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Path "${target}" is outside allowed root "${root}"`);
  }
}

export async function findGitRepos(basePath: string, maxDepth = 4): Promise<GitRepoInfo[]> {
  const repos: GitRepoInfo[] = [];
  const resolvedBase = path.resolve(basePath);

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    const gitDir = path.join(dir, '.git');
    try {
      await fs.promises.access(gitDir);
      const files = await getRepoStatus(dir);
      repos.push({
        path: dir,
        name: path.relative(resolvedBase, dir) || path.basename(dir),
        files,
      });
      return; // Don't recurse into git repos
    } catch {
      // Not a git repo, continue scanning
    }

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      const subdirs = entries.filter(
        e => e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')
      );
      await Promise.all(
        subdirs.map(entry => scan(path.join(dir, entry.name), depth + 1))
      );
    } catch {
      // Permission denied or other errors — skip
    }
  }

  await scan(resolvedBase, 0);
  return repos;
}

async function getRepoStatus(repoPath: string): Promise<GitFileInfo[]> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: repoPath,
      timeout: 5000,
    });
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => ({
        status: line.substring(0, 2).trim() || '?',
        file: line.substring(3),
      }));
  } catch {
    return [];
  }
}

/**
 * Get the diff for a single file. Uses execFile (no shell) to prevent injection.
 * The repoPath is validated to be within allowedRoot.
 */
export async function getFileDiff(
  repoPath: string,
  filePath: string,
  allowedRoot: string,
): Promise<string> {
  assertPathWithin(repoPath, allowedRoot);

  // Also validate the resolved file path stays within the repo
  const resolvedFile = path.resolve(repoPath, filePath);
  assertPathWithin(resolvedFile, repoPath);

  try {
    // Try staged + unstaged diff first
    const { stdout: headDiff } = await execFileAsync(
      'git', ['diff', 'HEAD', '--', filePath],
      { cwd: repoPath, timeout: 5000 },
    );
    if (headDiff.trim()) return headDiff;

    // If empty, try just unstaged
    const { stdout: unstagedDiff } = await execFileAsync(
      'git', ['diff', '--', filePath],
      { cwd: repoPath, timeout: 5000 },
    );
    if (unstagedDiff.trim()) return unstagedDiff;

    // Might be a new untracked file — create a synthetic diff
    try {
      const fullPath = path.resolve(repoPath, filePath);
      assertPathWithin(fullPath, repoPath);
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      return [
        `diff --git a/${filePath} b/${filePath}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${filePath}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map(l => `+${l}`),
      ].join('\n');
    } catch {
      return '';
    }
  } catch {
    return '';
  }
}

/**
 * Get the full diff for an entire repo. Uses execFile (no shell) to prevent injection.
 */
export async function getFullRepoDiff(
  repoPath: string,
  allowedRoot: string,
): Promise<string> {
  assertPathWithin(repoPath, allowedRoot);

  let diff = '';

  try {
    // Try staged + unstaged diff against HEAD
    try {
      const { stdout } = await execFileAsync('git', ['diff', 'HEAD'], {
        cwd: repoPath,
        timeout: 10000,
        maxBuffer: 1024 * 1024 * 5,
      });
      diff = stdout;
    } catch {
      // HEAD may not exist (no commits yet) — try staged, then unstaged
      try {
        const { stdout: cached } = await execFileAsync('git', ['diff', '--cached'], {
          cwd: repoPath,
          timeout: 10000,
          maxBuffer: 1024 * 1024 * 5,
        });
        diff = cached;
      } catch {
        // ignore
      }
      try {
        const { stdout: unstaged } = await execFileAsync('git', ['diff'], {
          cwd: repoPath,
          timeout: 10000,
          maxBuffer: 1024 * 1024 * 5,
        });
        if (unstaged.trim()) {
          diff += (diff ? '\n' : '') + unstaged;
        }
      } catch {
        // ignore
      }
    }

    // Also get untracked files
    const { stdout: untrackedOutput } = await execFileAsync(
      'git', ['ls-files', '--others', '--exclude-standard'],
      { cwd: repoPath, timeout: 5000 },
    );

    const untrackedFiles = untrackedOutput.trim().split('\n').filter(Boolean);
    for (const file of untrackedFiles) {
      const fileDiff = await getFileDiff(repoPath, file, allowedRoot);
      if (fileDiff) {
        diff += (diff ? '\n' : '') + fileDiff;
      }
    }

    return diff;
  } catch {
    return '';
  }
}
