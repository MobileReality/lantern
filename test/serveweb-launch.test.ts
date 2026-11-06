import { describe, expect, it } from 'vitest';
import {
  RECONNECTION_GRACE_SECONDS,
  chooseServerCommand,
  directServerArgs,
  locateServerInstall,
  serveWebArgs,
  type LaunchFs,
  type ServerCommandRequest,
} from '../src/main/serveweb-launch';

const COMMIT = '6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1';
const HOME = '/Users/me';
const APP = '/Applications/Visual Studio Code.app/Contents/Resources/app';
const CODE_BIN = `${APP}/bin/code`;
const MISSING_ROOT = '/nowhere';
const SERVER_BIN =`${HOME}/.vscode/cli/serve-web/${COMMIT}/bin/code-server`;
const TOKEN = 'a1b2c3';
const DIRS = { data: `${HOME}/.vscode-server`, extensions: `${HOME}/.vscode-server/extensions`, user: `${HOME}/.vscode-server/data` };

interface FakeDisk {
  links?: Record<string, string>;
  files?: Record<string, string>;
  executable?: string[];
}

function fakeFs({ links = {}, files = {}, executable = [] }: FakeDisk): LaunchFs {
  return {
    realpath: (file) => {
      if (file.startsWith(MISSING_ROOT)) throw new Error(`ENOENT ${file}`);
      return links[file] ?? file;
    },
    readText: (file) => files[file] ?? null,
    isExecutable: (file) => executable.includes(file),
  };
}

const product = (extra: Record<string, unknown> = {}) => JSON.stringify({ commit: COMMIT, dataFolderName: '.vscode', ...extra });
const installed = (): FakeDisk => ({ files: { [`${APP}/product.json`]: product() }, executable: [SERVER_BIN] });

function request(disk: FakeDisk, extra: Partial<ServerCommandRequest> = {}): ServerCommandRequest {
  return {
    codeBin: CODE_BIN,
    port: 9888,
    token: TOKEN,
    licenseAccepted: true,
    home: HOME,
    platform: 'darwin',
    dirs: DIRS,
    fs: fakeFs(disk),
    reclaimIdleHosts: true,
    directLaunchFailed: false,
    ...extra,
  };
}

describe('serveWebArgs', () => {
  it('is the unchanged `code serve-web` argument list', () => {
    expect(serveWebArgs(9890, TOKEN, true)).toEqual(['serve-web', '--port', '9890', '--connection-token', TOKEN, '--accept-server-license-terms']);
  });

  it('never accepts the server licence before the user consented', () => {
    expect(serveWebArgs(9890, TOKEN, false)).not.toContain('--accept-server-license-terms');
  });
});

describe('directServerArgs', () => {
  it('binds loopback with the connection token and carries the reconnection grace time and the same stores', () => {
    const args = directServerArgs(9890, TOKEN, DIRS, true);
    expect(args).toEqual([
      '--host', '127.0.0.1',
      '--port', '9890',
      '--connection-token', TOKEN,
      '--accept-server-license-terms',
      '--server-data-dir', DIRS.data,
      '--user-data-dir', DIRS.user,
      '--extensions-dir', DIRS.extensions,
      '--reconnection-grace-time', String(RECONNECTION_GRACE_SECONDS),
    ]);
  });

  it('never accepts the server licence before the user consented', () => {
    expect(directServerArgs(9890, TOKEN, DIRS, false)).not.toContain('--accept-server-license-terms');
  });

  it('never accepts the server licence before the user consented', () => {
    expect(directServerArgs(9890, TOKEN, DIRS, false)).not.toContain('--accept-server-license-terms');
  });

  it('uses a one minute grace time by default', () => {
    expect(RECONNECTION_GRACE_SECONDS).toBe(60);
  });
});

describe('locateServerInstall', () => {
  it('finds the server build that matches the CLI commit', () => {
    expect(locateServerInstall(request(installed()))).toEqual({ ok: true, bin: SERVER_BIN, commit: COMMIT });
  });

  it('follows a symlinked `code` to the app that owns product.json', () => {
    const disk = installed();
    disk.links = { '/usr/local/bin/code': CODE_BIN };
    expect(locateServerInstall(request(disk, { codeBin: '/usr/local/bin/code' })).ok).toBe(true);
  });

  it('uses the data folder the CLI names, as Insiders does', () => {
    const disk: FakeDisk = {
      files: { [`${APP}/product.json`]: product({ dataFolderName: '.vscode-insiders' }) },
      executable: [`${HOME}/.vscode-insiders/cli/serve-web/${COMMIT}/bin/code-server`],
    };
    expect(locateServerInstall(request(disk))).toMatchObject({ ok: true });
  });

  it('refuses when that build is not downloaded yet', () => {
    const result = locateServerInstall(request({ files: { [`${APP}/product.json`]: product() } }));
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toContain('not installed');
  });

  it('refuses on Windows', () => {
    expect(locateServerInstall(request(installed(), { platform: 'win32' }))).toMatchObject({ ok: false });
  });

  it.each([
    ['product.json is missing', {}],
    ['product.json is not JSON', { files: { [`${APP}/product.json`]: '{' } }],
    ['the commit is missing', { files: { [`${APP}/product.json`]: JSON.stringify({ dataFolderName: '.vscode' }) } }],
    ['the commit is not a hash', { files: { [`${APP}/product.json`]: JSON.stringify({ commit: '../../etc', dataFolderName: '.vscode' }) } }],
    ['the data folder is a path', { files: { [`${APP}/product.json`]: JSON.stringify({ commit: COMMIT, dataFolderName: '../x' }) } }],
  ] as [string, FakeDisk][])('refuses when %s', (_label, disk) => {
    expect(locateServerInstall(request({ ...disk, executable: [SERVER_BIN] })).ok).toBe(false);
  });

  it('refuses when the CLI path cannot be resolved', () => {
    expect(locateServerInstall(request(installed(), { codeBin: `${MISSING_ROOT}/code` })).ok).toBe(false);
  });
});

describe('chooseServerCommand', () => {
  it('launches the server binary directly with the grace time when idle reclaiming is on and the build is installed', () => {
    const command = chooseServerCommand(request(installed()));
    expect(command).toMatchObject({ kind: 'direct', bin: SERVER_BIN, commit: COMMIT, graceSeconds: RECONNECTION_GRACE_SECONDS });
    expect(command.args).toEqual(directServerArgs(9888, TOKEN, DIRS, true));
    expect(command.args).toContain('--reconnection-grace-time');
  });

  it('starts `code serve-web` exactly as before when idle reclaiming is off', () => {
    const command = chooseServerCommand(request(installed(), { reclaimIdleHosts: false }));
    expect(command).toEqual({ kind: 'serve-web', bin: CODE_BIN, args: serveWebArgs(9888, TOKEN, true), graceSeconds: null });
  });

  it('falls back to `code serve-web` with a warning when the build is not installed', () => {
    const command = chooseServerCommand(request({ files: { [`${APP}/product.json`]: product() } }));
    expect(command).toMatchObject({ kind: 'serve-web', bin: CODE_BIN, args: serveWebArgs(9888, TOKEN, true), graceSeconds: null });
    expect(command.kind === 'serve-web' && command.warning).toContain('not installed');
    expect(command.args).not.toContain('--reconnection-grace-time');
  });

  it('falls back on Windows', () => {
    const command = chooseServerCommand(request(installed(), { platform: 'win32' }));
    expect(command).toMatchObject({ kind: 'serve-web', graceSeconds: null });
  });

  it('stays on `code serve-web` after a direct launch failed, without repeating the warning', () => {
    const command = chooseServerCommand(request(installed(), { directLaunchFailed: true }));
    expect(command).toEqual({ kind: 'serve-web', bin: CODE_BIN, args: serveWebArgs(9888, TOKEN, true), graceSeconds: null });
  });

  it('passes the chosen port through', () => {
    expect(chooseServerCommand(request(installed(), { port: 9901 })).args).toContain('9901');
  });

  it('carries no licence flag on either route while the licence is not accepted', () => {
    for (const reclaimIdleHosts of [true, false]) {
      const command = chooseServerCommand(request(installed(), { reclaimIdleHosts, licenseAccepted: false }));
      expect(command.args).not.toContain('--accept-server-license-terms');
    }
  });
});
