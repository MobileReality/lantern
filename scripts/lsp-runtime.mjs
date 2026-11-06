import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ENTRIES = { vtsls: 'node_modules/@vtsls/language-server/bin/vtsls.js' };
const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const requestedPlatform = valueAfter('--target-platform');
const requestedArch = valueAfter('--target-arch');

if ((requestedPlatform && requestedPlatform !== process.platform) || (requestedArch && requestedArch !== process.arch)) {
  throw new Error(`The bundled LSP Node runtime is ${process.platform}/${process.arch}, not ${requestedPlatform ?? process.platform}/${requestedArch ?? process.arch}`);
}

function pnpmInvocation(pnpmCli, args) {
  const extension = path.extname(pnpmCli).toLowerCase();
  if (extension === '.cmd' || extension === '.bat') throw new Error('Windows command shims are unsupported; set npm_execpath to pnpm.cjs or the native pnpm executable');
  return ['.js', '.cjs', '.mjs'].includes(extension) ? { file: process.execPath, args: [pnpmCli, ...args] } : { file: pnpmCli, args };
}

function runtimeFingerprint(root = process.cwd()) {
  const hash = createHash('sha256');
  for (const relative of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'packages/lsp-runtime/package.json', 'scripts/lsp-runtime.mjs']) {
    hash.update(relative).update('\0').update(readFileSync(path.join(root, relative))).update('\0');
  }
  return hash.update(`${process.version}\0${process.platform}\0${process.arch}`).digest('hex');
}

function validRuntime(directory, fingerprint) {
  try {
    const metadata = JSON.parse(readFileSync(path.join(directory, 'runtime.json'), 'utf8'));
    if (metadata.fingerprint !== fingerprint || metadata.node !== process.version || metadata.platform !== process.platform || metadata.arch !== process.arch) return false;
    if (!existsSync(path.join(directory, process.platform === 'win32' ? 'node.exe' : 'node')) || !existsSync(path.join(directory, 'NODE-LICENSE'))) return false;
    if (Object.keys(metadata.entries ?? {}).length !== Object.keys(ENTRIES).length || Object.entries(ENTRIES).some(([name, entry]) => metadata.entries[name] !== entry)) return false;
    return Object.values(ENTRIES).every((entry) => {
      readFileSync(path.join(directory, 'app', entry), { encoding: 'utf8', flag: 'r' });
      return true;
    });
  } catch { return false; }
}

function buildLspRuntime({ root = process.cwd(), out = path.resolve('out/lsp-runtime'), run = execFileSync, pnpmCli = process.env.npm_execpath } = {}) {
  const fingerprint = runtimeFingerprint(root);
  if (validRuntime(out, fingerprint)) return false;
  if (!pnpmCli || !existsSync(pnpmCli)) throw new Error('Build the LSP runtime through pnpm so its portable CLI path is available');
  mkdirSync(path.dirname(out), { recursive: true });
  const pending = mkdtempSync(path.join(path.dirname(out), `.${path.basename(out)}-${process.pid}-`));
  try {
    // ponytail: hoisted linker so the shipped runtime has no symlinks; Windows cannot recreate them when electron-packager copies it
    const args = ['--filter', '@lantern/lsp-runtime', 'deploy', '--prod', '--config.node-linker=hoisted', path.join(pending, 'app')];
    const invocation = pnpmInvocation(pnpmCli, args);
    run(invocation.file, invocation.args, { stdio: 'inherit' });
    rmSync(path.join(pending, 'app', 'node_modules', '.bin'), { recursive: true, force: true });

    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
    cpSync(process.execPath, path.join(pending, nodeName));

    let nodeRoot = path.dirname(process.execPath);
    while (!existsSync(path.join(nodeRoot, 'LICENSE')) && path.dirname(nodeRoot) !== nodeRoot) nodeRoot = path.dirname(nodeRoot);
    if (!existsSync(path.join(nodeRoot, 'LICENSE'))) throw new Error(`Could not find the Node license above ${process.execPath}`);
    cpSync(path.join(nodeRoot, 'LICENSE'), path.join(pending, 'NODE-LICENSE'));

    const metadata = { node: process.version, platform: process.platform, arch: process.arch, fingerprint, entries: ENTRIES };
    writeFileSync(path.join(pending, 'runtime.json'), `${JSON.stringify(metadata, null, 2)}\n`);

    if (!validRuntime(pending, fingerprint)) throw new Error('Built LSP runtime is incomplete');
    rmSync(out, { recursive: true, force: true });
    try {
      renameSync(pending, out);
    } catch (error) {
      if (!validRuntime(out, fingerprint)) throw error;
    }
    return true;
  } finally {
    rmSync(pending, { recursive: true, force: true });
  }
}

export { buildLspRuntime, pnpmInvocation, runtimeFingerprint, validRuntime };
