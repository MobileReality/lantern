import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface FakeRtkOptions {
  version?: string;
  gain?: boolean;
  pipeline?: boolean | 'broken';
  versionExit?: number;
}

export const HOOK_SETTINGS = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }] } };

export function fakeRtk(dir: string, { version = 'rtk 1.0.1', gain = true, pipeline = true, versionExit = 0 }: FakeRtkOptions = {}) {
  const gainBranch = gain
    ? `gain) db="\${RTK_DB_PATH:-$HOME/.local/share/rtk/history.db}"; mkdir -p "$(dirname "$db")"; echo row >> "$db"; echo "Total saved: 0"; exit 0 ;;`
    : '';
  const pipelineBranch = pipeline === true ? 'pipeline) echo "usage: rtk pipeline"; exit 0 ;;' : pipeline === 'broken' ? 'pipeline) echo "boom" >&2; exit 1 ;;' : '';
  const file = path.join(dir, 'rtk');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    file,
    `#!/bin/sh
echo "$1|db=\${RTK_DB_PATH-unset}" >> "\${FAKE_RTK_LOG:-/dev/null}"
case "$1" in
  --version) echo "${version}"; exit ${versionExit} ;;
  ${gainBranch}
  ${pipelineBranch}
esac
echo "error: unrecognized subcommand '$1'" >&2
exit 2
`,
    { mode: 0o755 },
  );
  fs.chmodSync(file, 0o755);
  return file;
}

export function treeHash(root: string) {
  const entries: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isDirectory()) {
        entries.push(`dir:${rel}`);
        walk(full);
      } else {
        entries.push(`file:${rel}:${createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`);
      }
    }
  };
  walk(root);
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

export function writeSettings(dir: string, name: string, value: unknown) {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', name), typeof value === 'string' ? value : JSON.stringify(value));
}
