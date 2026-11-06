import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import electron from 'electron';
import { build } from 'esbuild';

const run = promisify(execFile);
const root = process.cwd();
const appDir = path.join(root, 'test/e2e/app');
const userData = await mkdtemp(path.join(tmpdir(), 'lantern-pr-review-demo-'));
let child;
let interrupted = false;

function interrupt(signal) {
  if (interrupted) return;
  interrupted = true;
  child?.kill(signal);
}

const onSigint = () => interrupt('SIGINT');
const onSigterm = () => interrupt('SIGTERM');
process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigterm);

try {
  await run(process.execPath, [path.join(root, 'scripts/material-file-icons.mjs'), path.join(root, 'test/e2e/assets/file-icons')]);
  await Promise.all([build({
    entryPoints: [path.join(appDir, 'renderer.ts')],
    outfile: path.join(appDir, 'renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
    define: { __LANTERN_REAL_MAP__: 'null' },
  }), build({
    entryPoints: [path.join(root, 'src/renderer/lib/syntax-worker.ts')],
    outfile: path.join(appDir, 'syntax-worker.js'),
    bundle: true, platform: 'browser', format: 'iife', target: 'chrome130',
  })]);
  if (!interrupted) {
    child = spawn(electron, [path.join(appDir, 'main.cjs')], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '', LANTERN_GRAPH_USER_DATA: userData, LANTERN_GRAPH_FIXTURE: 'pr-review', LANTERN_GRAPH_FLOW: 'rich' },
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (code && !interrupted) process.exitCode = Number(code);
  }
} finally {
  try {
    await rm(userData, { recursive: true, force: true });
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}
