import path from 'node:path';

export const RECONNECTION_GRACE_SECONDS = 60;

const LOOPBACK = '127.0.0.1';
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const PRODUCT_FILE = 'product.json';
const SERVE_WEB_STORE = path.join('cli', 'serve-web');
const SERVER_BIN = path.join('bin', 'code-server');

export interface ServerDirs {
  data: string;
  extensions: string;
  user: string;
}

export interface LaunchFs {
  realpath(file: string): string;
  readText(file: string): string | null;
  isExecutable(file: string): boolean;
}

export interface DirectLaunchRequest {
  codeBin: string;
  port: number;
  token: string;
  licenseAccepted: boolean;
  home: string;
  platform: NodeJS.Platform;
  dirs: ServerDirs;
  fs: LaunchFs;
}

export type DirectLaunch =
  | { ok: true; bin: string; args: string[]; commit: string; graceSeconds: number }
  | { ok: false; reason: string };

type Install = { ok: true; bin: string; commit: string } | { ok: false; reason: string };

const LICENSE_FLAG = '--accept-server-license-terms';

export function serveWebArgs(port: number, token: string, licenseAccepted: boolean): string[] {
  return ['serve-web', '--port', String(port), '--connection-token', token, ...(licenseAccepted ? [LICENSE_FLAG] : [])];
}

export function directServerArgs(port: number, token: string, dirs: ServerDirs, licenseAccepted: boolean, graceSeconds = RECONNECTION_GRACE_SECONDS): string[] {
  return [
    '--host',
    LOOPBACK,
    '--port',
    String(port),
    '--connection-token',
    token,
    ...(licenseAccepted ? [LICENSE_FLAG] : []),
    '--server-data-dir',
    dirs.data,
    '--user-data-dir',
    dirs.user,
    '--extensions-dir',
    dirs.extensions,
    '--reconnection-grace-time',
    String(graceSeconds),
  ];
}

function readProduct(fs: LaunchFs, codeBin: string): { commit: unknown; dataFolderName: unknown } | string {
  let productFile: string;
  try {
    productFile = path.join(path.dirname(path.dirname(fs.realpath(codeBin))), PRODUCT_FILE);
  } catch {
    return `cannot resolve ${codeBin}`;
  }
  const text = fs.readText(productFile);
  if (text === null) return `cannot read ${productFile}`;
  try {
    const product = JSON.parse(text);
    return { commit: product?.commit, dataFolderName: product?.dataFolderName };
  } catch {
    return `${productFile} is not valid JSON`;
  }
}

function isFolderName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\\/]/.test(value) && value !== '.' && value !== '..';
}

// `code serve-web` downloads the server build that matches its own commit into
// <dataFolderName>/cli/serve-web/<commit>. Only that exact build is ever launched directly, so
// a VS Code update (build not downloaded yet) falls back to serve-web, which fetches it.
export function locateServerInstall(request: Pick<DirectLaunchRequest, 'codeBin' | 'home' | 'platform' | 'fs'>): Install {
  if (request.platform === 'win32') return { ok: false, reason: 'direct launch is not supported on Windows' };
  const product = readProduct(request.fs, request.codeBin);
  if (typeof product === 'string') return { ok: false, reason: product };
  const { commit, dataFolderName } = product;
  if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) return { ok: false, reason: 'the VS Code CLI reports no build commit' };
  if (!isFolderName(dataFolderName)) return { ok: false, reason: 'the VS Code CLI reports no data folder name' };
  const bin = path.join(request.home, dataFolderName, SERVE_WEB_STORE, commit, SERVER_BIN);
  if (!request.fs.isExecutable(bin)) return { ok: false, reason: `server build ${commit} is not installed at ${bin}` };
  return { ok: true, bin, commit };
}

export function planDirectLaunch(request: DirectLaunchRequest): DirectLaunch {
  const install = locateServerInstall(request);
  if (!install.ok) return install;
  return {
    ok: true,
    bin: install.bin,
    commit: install.commit,
    args: directServerArgs(request.port, request.token, request.dirs, request.licenseAccepted),
    graceSeconds: RECONNECTION_GRACE_SECONDS,
  };
}

export interface ServerCommandRequest extends DirectLaunchRequest {
  reclaimIdleHosts: boolean;
  directLaunchFailed: boolean;
}

export type ServerCommand =
  | { kind: 'direct'; bin: string; args: string[]; commit: string; graceSeconds: number }
  | { kind: 'serve-web'; bin: string; args: string[]; graceSeconds: null; warning?: string };

export function chooseServerCommand(request: ServerCommandRequest): ServerCommand {
  const serveWeb: ServerCommand = { kind: 'serve-web', bin: request.codeBin, args: serveWebArgs(request.port, request.token, request.licenseAccepted), graceSeconds: null };
  if (!request.reclaimIdleHosts || request.directLaunchFailed) return serveWeb;
  const plan = planDirectLaunch(request);
  if (!plan.ok) return { ...serveWeb, warning: plan.reason };
  return { kind: 'direct', bin: plan.bin, args: plan.args, commit: plan.commit, graceSeconds: plan.graceSeconds };
}
