import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installMainCapture } from '../src/main/diagnostics/capture';
import { commandText, createServerOutputReporter, describeLaunchError, describeProbe, describeServerStop } from '../src/main/diagnostics/editor-server';
import { guardIpc } from '../src/main/diagnostics/ipc-guard';
import { HOME, PROJECT, makeLogDir, startService } from './helpers/diagnostics-world';

function world() {
  const service = startService(makeLogDir());
  const proc = new EventEmitter();
  const app = new EventEmitter();
  installMainCapture({ proc, app, report: (input) => service.record(input) });
  const recorded = () => service.listing().entries;
  return { service, proc, app, recorded };
}

describe('capturing failures of the main process', () => {
  it('records an uncaught exception as a crash with its stack and redacted paths', () => {
    const { proc, recorded } = world();
    const error = new Error(`cannot read ${HOME}/notes.txt`);
    error.stack = `Error: cannot read ${HOME}/notes.txt\n    at open (${PROJECT}/src/app.js:3:9)`;
    proc.emit('uncaughtExceptionMonitor', error, 'uncaughtException');
    const entry = recorded().at(-1)!;
    expect(entry).toMatchObject({ source: 'main', severity: 'fatal', platform: 'win32', version: '0.2.2' });
    expect(entry.message).toBe('Error: cannot read ~/notes.txt');
    expect(entry.detail).toContain('<project>/src/app.js:3:9');
    expect(entry.detail).toContain('Origin: uncaughtException');
    expect(JSON.stringify(entry)).not.toContain('jane');
    expect(JSON.stringify(entry)).not.toContain('secret-client');
  });

  it('records an unhandled rejection without letting it pass silently', () => {
    const { proc, recorded } = world();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    proc.emit('unhandledRejection', new Error('nobody caught this'));
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
    expect(recorded().at(-1)).toMatchObject({ source: 'main', severity: 'error', message: 'Unhandled promise rejection: Error: nobody caught this' });
  });

  it('records a crashed window process and ignores a clean exit', () => {
    const { app, recorded } = world();
    const before = recorded().length;
    app.emit('render-process-gone', {}, {}, { reason: 'clean-exit', exitCode: 0 });
    expect(recorded()).toHaveLength(before);
    app.emit('render-process-gone', {}, {}, { reason: 'crashed', exitCode: 139 });
    expect(recorded().at(-1)).toMatchObject({ source: 'render-process', severity: 'fatal', exitCode: 139, message: 'A window process is gone: crashed' });
  });

  it('records a helper process that is gone with its kind and exit code', () => {
    const { app, recorded } = world();
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'oom', exitCode: 9 });
    expect(recorded().at(-1)).toMatchObject({ source: 'child-process', severity: 'fatal', exitCode: 9, message: 'A GPU process is gone: oom' });
  });

  it('records a window that stops responding', () => {
    const { app, recorded } = world();
    const contents = new EventEmitter();
    app.emit('web-contents-created', {}, contents);
    contents.emit('unresponsive');
    expect(recorded().at(-1)).toMatchObject({ source: 'render-process', severity: 'warning', message: 'A window stopped responding' });
  });
});

describe('recording a failing IPC handler', () => {
  function ipc() {
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const target = {
      handle: (channel: string, listener: (...args: unknown[]) => unknown) => void registered.set(channel, listener),
      on: (channel: string, listener: (...args: unknown[]) => unknown) => void registered.set(channel, listener),
    };
    return { target, call: (channel: string, ...args: unknown[]) => registered.get(channel)!(...args) };
  }

  it('records a synchronous throw and an async rejection, then rethrows them unchanged', async () => {
    const { service, recorded } = (() => {
      const s = startService(makeLogDir());
      return { service: s, recorded: () => s.listing().entries };
    })();
    const { target, call } = ipc();
    guardIpc(target, (input) => service.record(input));
    target.handle('lantern:load', () => {
      throw new Error('sync boom');
    });
    target.handle('lantern:stamp', async () => {
      throw new Error('async boom');
    });
    expect(() => call('lantern:load')).toThrow('sync boom');
    await expect(call('lantern:stamp')).rejects.toThrow('async boom');
    const messages = recorded().map((e) => e.message);
    expect(messages).toContain('A request on lantern:load failed: Error: sync boom');
    expect(messages).toContain('A request on lantern:stamp failed: Error: async boom');
    expect(recorded().at(-1)).toMatchObject({ source: 'ipc', severity: 'error' });
  });

  it('records nothing for a handler that succeeds and passes its result through', async () => {
    const service = startService(makeLogDir());
    const before = service.listing().entries.length;
    const { target, call } = ipc();
    guardIpc(target, (input) => service.record(input));
    target.handle('ws:info', async () => ({ ready: true }));
    await expect(call('ws:info')).resolves.toEqual({ ready: true });
    expect(service.listing().entries).toHaveLength(before);
  });
});

describe('the VS Code server lifecycle', () => {
  const command = commandText('C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd', ['serve-web', '--port', '9888', '--connection-token', 'a'.repeat(48)]);

  it('writes a non-zero exit code with its last output and redacted paths and token', () => {
    const service = startService(makeLogDir());
    const input = describeServerStop({ code: 1, signal: null, wasReady: false, platform: 'win32', command: `${command} --user-data-dir ${HOME}/.vscode-server`, tail: [`Error: cannot open ${PROJECT}/.vscode`] });
    service.record(input!);
    const entry = service.listing().entries.at(-1)!;
    expect(entry).toMatchObject({ source: 'editor-server', severity: 'error', exitCode: 1, message: 'The VS Code server exited with code 1 before the editor was ready' });
    expect(entry.detail).toContain('Last output:');
    expect(entry.detail).toContain('On Windows');
    expect(entry.detail).toContain('--connection-token [redacted]');
    expect(entry.detail).toContain('~/.vscode-server');
    expect(entry.detail).not.toContain('a'.repeat(48));
    expect(entry.detail).not.toContain('secret-client');
  });

  it('names the signal when the server was stopped and records nothing for a clean exit after ready', () => {
    expect(describeServerStop({ code: null, signal: 'SIGKILL', wasReady: true, platform: 'darwin', command, tail: [] })).toMatchObject({ signal: 'SIGKILL', message: expect.stringContaining('SIGKILL') });
    expect(describeServerStop({ code: 0, signal: null, wasReady: true, platform: 'darwin', command, tail: [] })).toBeNull();
    expect(describeServerStop({ code: 0, signal: null, wasReady: false, platform: 'darwin', command, tail: [] })).not.toBeNull();
  });

  it('explains a launch error with the command that was run', () => {
    const error = Object.assign(new Error('spawn code.cmd ENOENT'), { code: 'ENOENT' });
    expect(describeLaunchError(error, command, 'win32')).toMatchObject({ severity: 'error', message: 'The VS Code server could not be launched (ENOENT): spawn code.cmd ENOENT' });
    expect(describeLaunchError(error, command, 'win32').detail).toContain('code.cmd');
  });

  it('turns stderr lines into entries, marks errors, and stops after a bounded number', () => {
    const service = startService(makeLogDir());
    const stderr = createServerOutputReporter((input) => service.record(input), 3);
    for (const line of ['', 'Error: EADDRINUSE 127.0.0.1:9888', 'warming up', 'line three', 'line four', 'line five']) stderr.push(line);
    const entries = service.listing().entries.filter((e) => e.source === 'editor-server');
    expect(entries.map((e) => [e.severity, e.message])).toEqual([
      ['error', 'Editor server output: Error: EADDRINUSE 127.0.0.1:9888'],
      ['warning', 'Editor server output: warming up'],
      ['warning', 'Editor server output: line three'],
      ['warning', 'More editor server output was left out of the log.'],
    ]);
  });

  it('says what the health check last saw', () => {
    expect(describeProbe(null, 9888)).toBe('nothing answered on port 9888');
    expect(describeProbe('other', 9888)).toContain('not the VS Code editor');
  });
});
