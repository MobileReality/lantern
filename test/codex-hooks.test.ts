import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CODEX_EVENTS } from '../src/main/codex-event';
import { commands, ensureToken, install, paths, powershellQuote, shQuote, status, uninstall } from '../src/main/codex-hooks';

let root: string;
let userData: string;
let codexHome: string;
let bundledDir: string;

function target() {
  return paths(userData, bundledDir, { CODEX_HOME: codexHome }, path.join(root, 'unused-home'));
}

function writeConfig(value: unknown, mode = 0o644) {
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'hooks.json'), `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.chmodSync(path.join(codexHome, 'hooks.json'), mode);
}

function backups() {
  return fs.existsSync(codexHome) ? fs.readdirSync(codexHome).filter((name) => name.startsWith('hooks.json.lantern-bak')) : [];
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lantern-codex-hooks-'));
  userData = path.join(root, "User data's & space");
  codexHome = path.join(root, "Codex home's & space");
  bundledDir = path.join(root, 'bundle');
  fs.mkdirSync(bundledDir, { recursive: true });
  fs.writeFileSync(path.join(bundledDir, 'codex.sh'), '#!/bin/sh\nprintf \'{}\\n\'\n');
  fs.writeFileSync(path.join(bundledDir, 'codex.ps1'), 'Write-Output "{}"\n');
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('Codex hook token and commands', () => {
  it('creates one stable token with owner-only permissions', () => {
    const first = ensureToken(target());
    const second = ensureToken(target());
    expect(first).toMatch(/^[a-f0-9]{48}$/);
    expect(second).toBe(first);
    expect(fs.statSync(target().tokenFile).mode & 0o777).toBe(0o600);
  });

  it('quotes POSIX values and keeps Windows paths inside an encoded literal script', () => {
    const value = "a path's %value%! ^ &";
    expect(execFileSync('/bin/sh', ['-c', `set -- ${shQuote(value)}; printf %s "$1"`], { encoding: 'utf8' })).toBe(value);
    expect(powershellQuote(value)).toBe("'a path''s %value%! ^ &'");
    const generated = commands(target());
    expect(generated.command).toContain("'\"'\"'");
    const encoded = generated.commandWindows.split(' ').at(-1)!;
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toContain(powershellQuote(path.join(target().scriptsDir, 'codex.ps1')));
    expect(decoded).toContain(powershellQuote(target().tokenFile));
    expect(generated.commandWindows).not.toContain(userData);
  });
});

describe('Codex hooks config', () => {
  it('checks status without creating config, token, or script directories', () => {
    expect(status(target())).toEqual({ configured: false, configFile: target().configFile });
    expect(fs.existsSync(codexHome)).toBe(false);
    expect(fs.existsSync(userData)).toBe(false);
  });

  it('preserves foreign config and mode, backs up once, and refreshes scripts idempotently', () => {
    const original = {
      description: 'foreign config',
      extra: { keep: true },
      hooks: {
        Stop: [{ matcher: 'foreign', custom: 7, hooks: [{ type: 'command', command: 'foreign-stop', statusMessage: 'keep' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'mcp_tool', server: 'scanner', tool: 'scan' }] }],
      },
    };
    writeConfig(original);
    const first = install(target());
    expect(first).toMatchObject({ changed: true, configured: true });
    expect(status(target()).configured).toBe(true);
    expect(fs.statSync(target().configFile).mode & 0o777).toBe(0o644);
    expect(backups()).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(codexHome, backups()[0]), 'utf8'))).toEqual(original);
    const installed = JSON.parse(fs.readFileSync(target().configFile, 'utf8'));
    expect(installed.description).toBe(original.description);
    expect(installed.extra).toEqual(original.extra);
    expect(installed.hooks.PreToolUse).toEqual(original.hooks.PreToolUse);
    expect(installed.hooks.Stop[0]).toEqual(original.hooks.Stop[0]);
    const ownedByEvent = Object.fromEntries(CODEX_EVENTS.map((event) => [event, installed.hooks[event].flatMap((group: any) => group.hooks).find((hook: any) => hook.command === commands(target()).command)]));
    for (const event of CODEX_EVENTS) expect(ownedByEvent[event]).toBeTruthy();
    expect(ownedByEvent.SessionStart.async).toBeUndefined();
    expect(ownedByEvent.SessionStart.timeout).toBe(2);
    expect(ownedByEvent.SessionEnd).toMatchObject({ timeout: 3 });
    expect(ownedByEvent.PermissionRequest).toMatchObject({ async: true, timeout: 2 });
    expect(ownedByEvent.Stop).toMatchObject({ async: true, timeout: 2 });
    for (const name of ['codex.sh', 'codex.ps1']) expect(fs.statSync(path.join(target().scriptsDir, name)).mode & 0o777).toBe(0o700);

    const second = install(target());
    expect(second).toMatchObject({ changed: false, configured: true });
    expect(backups()).toHaveLength(1);

    uninstall(target());
    install(target());
    expect(backups()).toEqual(['hooks.json.lantern-bak']);
  });

  it('removes only exact owned handlers and keeps mixed groups and unknown fields', () => {
    const owned = { type: 'command', command: commands(target()).command, commandWindows: 'old', timeout: 1 };
    const foreign = { type: 'command', command: 'foreign', custom: true };
    writeConfig({
      description: 'keep',
      hooks: {
        Stop: [{ matcher: 'all', groupField: 9, hooks: [foreign, owned] }],
        SessionStart: [{ hooks: [owned] }],
        CustomEvent: [{ matcher: 'x', hooks: [foreign] }],
      },
    });
    const result = uninstall(target());
    expect(result.changed).toBe(true);
    const next = JSON.parse(fs.readFileSync(target().configFile, 'utf8'));
    expect(next.description).toBe('keep');
    expect(next.hooks.Stop).toEqual([{ matcher: 'all', groupField: 9, hooks: [foreign] }]);
    expect(next.hooks.SessionStart).toBeUndefined();
    expect(next.hooks.CustomEvent).toEqual([{ matcher: 'x', hooks: [foreign] }]);
  });

  it.each([
    '{',
    '[]',
    '{"hooks":[]}',
    '{"hooks":{"Stop":{}}}',
    '{"hooks":{"Stop":[{"hooks":{}}]}}',
    '{"hooks":{"Stop":[{"hooks":[null]}]}}',
  ])('refuses malformed config without changing it or creating a backup', (content) => {
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(target().configFile, content);
    expect(() => install(target())).toThrow();
    expect(fs.readFileSync(target().configFile, 'utf8')).toBe(content);
    expect(backups()).toEqual([]);
    expect(fs.existsSync(target().tokenFile)).toBe(false);
  });

  it('refuses symlinked config, token, script, and missing destination ancestors', () => {
    const external = path.join(root, 'external');
    fs.mkdirSync(external);
    const sentinel = path.join(external, 'sentinel');
    fs.writeFileSync(sentinel, 'safe');

    fs.mkdirSync(codexHome);
    fs.symlinkSync(sentinel, target().configFile);
    expect(() => install(target())).toThrow(/Unsafe/);
    fs.rmSync(target().configFile);

    fs.mkdirSync(userData, { recursive: true });
    fs.symlinkSync(sentinel, target().tokenFile);
    expect(() => ensureToken(target())).toThrow(/Unsafe/);
    fs.rmSync(target().tokenFile);

    ensureToken(target());
    fs.mkdirSync(target().scriptsDir);
    fs.symlinkSync(sentinel, path.join(target().scriptsDir, 'codex.sh'));
    expect(() => install(target())).toThrow(/Unsafe/);
    fs.rmSync(target().scriptsDir, { recursive: true });

    const linkedParent = path.join(root, 'linked-parent');
    fs.symlinkSync(external, linkedParent);
    codexHome = path.join(linkedParent, 'missing-child');
    expect(() => install(target())).toThrow(/Unsafe/);
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('safe');
  });

  it('refuses existing destinations below a symlink ancestor without changing external files', () => {
    const externalConfig = path.join(root, 'external-config', 'existing');
    fs.mkdirSync(externalConfig, { recursive: true });
    const externalConfigFile = path.join(externalConfig, 'hooks.json');
    fs.writeFileSync(externalConfigFile, '{"foreign":true}\n');
    const configLink = path.join(root, 'config-link');
    fs.symlinkSync(path.dirname(externalConfig), configLink);
    codexHome = path.join(configLink, 'existing');
    expect(() => install(target())).toThrow(/Unsafe path/);
    expect(fs.readFileSync(externalConfigFile, 'utf8')).toBe('{"foreign":true}\n');

    const externalToken = path.join(root, 'external-token', 'existing');
    fs.mkdirSync(externalToken, { recursive: true });
    const externalTokenFile = path.join(externalToken, 'codex-hooks.token');
    fs.writeFileSync(externalTokenFile, 'outside-token');
    const tokenLink = path.join(root, 'token-link');
    fs.symlinkSync(path.dirname(externalToken), tokenLink);
    userData = path.join(tokenLink, 'existing');
    expect(() => ensureToken(target())).toThrow(/Unsafe path/);
    expect(fs.readFileSync(externalTokenFile, 'utf8')).toBe('outside-token');

    userData = path.join(root, 'safe-user-data');
    codexHome = path.join(root, 'safe-codex-home');
    ensureToken(target());
    const externalScripts = path.join(root, 'external-scripts');
    fs.mkdirSync(externalScripts);
    fs.writeFileSync(path.join(externalScripts, 'codex.sh'), 'outside-shell');
    fs.writeFileSync(path.join(externalScripts, 'codex.ps1'), 'outside-powershell');
    fs.symlinkSync(externalScripts, target().scriptsDir);
    expect(() => install(target())).toThrow(/Unsafe path/);
    expect(fs.readFileSync(path.join(externalScripts, 'codex.sh'), 'utf8')).toBe('outside-shell');
    expect(fs.readFileSync(path.join(externalScripts, 'codex.ps1'), 'utf8')).toBe('outside-powershell');
  });
});
