import { execFile } from 'node:child_process';

const GIT_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 60_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const INHERITED_GIT_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY'];

interface GitResult {
  ok: boolean;
  code: number | string | null;
  stdout: string;
  stderr: string;
}

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
  for (const name of INHERITED_GIT_VARS) delete env[name];
  return env;
}

function git(project: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<GitResult> {
  return new Promise((resolve) => {
    try {
      execFile('git', args, { cwd: project, timeout, maxBuffer: GIT_MAX_BUFFER, env: gitEnv(), windowsHide: true }, (error, stdout, stderr) => {
        const code = error ? ((error as NodeJS.ErrnoException).code ?? -1) : 0;
        resolve({ ok: !error, code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      });
    } catch (e) {
      resolve({ ok: false, code: -1, stdout: '', stderr: (e as Error).message });
    }
  });
}

async function fetchOrigin(project: string): Promise<{ ok: boolean; error?: string }> {
  const res = await git(project, ['fetch', '--prune', '--quiet', 'origin'], FETCH_TIMEOUT_MS);
  if (res.ok) return { ok: true };
  return { ok: false, error: res.stderr.trim().split('\n')[0] || `git fetch failed (${res.code})` };
}

export { git, fetchOrigin, GIT_TIMEOUT_MS, FETCH_TIMEOUT_MS, GIT_MAX_BUFFER };
export type { GitResult };
