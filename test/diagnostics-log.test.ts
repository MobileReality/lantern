import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { crashNoticeFor, QUIT_NORMALLY } from '../src/main/diagnostics/lifecycle';
import { redactText } from '../src/main/diagnostics/redact';
import { DEFAULT_LIMITS, parseLog, rotateEntries, serializeEntry } from '../src/main/diagnostics/rotation';
import { createThrottle } from '../src/main/diagnostics/throttle';
import { HOME, PROJECT, entry, makeClock, makeLogDir, startService } from './helpers/diagnostics-world';

const context = { home: HOME, projects: () => [PROJECT] };

describe('redacting what is written to the log', () => {
  it('replaces the home folder, other users’ folders and project folders', () => {
    expect(redactText(`open ${HOME}/notes.txt`, context)).toBe('open ~/notes.txt');
    expect(redactText(`at ${PROJECT}/src/a.ts:1`, context)).toBe('at <project>/src/a.ts:1');
    expect(redactText('at /Users/someone-else/app/main.js', context)).toBe('at ~/app/main.js');
    expect(redactText('at /home/bob/.config/lantern', context)).toBe('at ~/.config/lantern');
  });

  it('handles Windows paths in either slash style and any letter case', () => {
    const windows = { home: 'C:\\Users\\Jane', projects: () => ['D:\\work\\Secret Client'] };
    expect(redactText('C:\\Users\\Jane\\AppData\\Local\\code.cmd', windows)).toBe('~\\AppData\\Local\\code.cmd');
    expect(redactText('c:/users/jane/AppData/code.cmd', windows)).toBe('~/AppData/code.cmd');
    expect(redactText('D:\\work\\Secret Client\\src\\a.ts', windows)).toBe('<project>\\src\\a.ts');
  });

  it('removes tokens: the editor connection token, query tokens and the credential patterns of the app', () => {
    const text = 'code serve-web --connection-token abc123def456 --port 1 http://127.0.0.1:9888/?tkn=secretvalue&x=1 Authorization: Bearer abcdefghijklmnop ghp_abcdefghijklmnopqrstuv';
    const out = redactText(text, context);
    expect(out).not.toMatch(/abc123def456|secretvalue|abcdefghijklmnop|ghp_/);
    expect(out).toContain('--connection-token [redacted]');
    expect(out).toContain('tkn=[redacted]&x=1');
  });

  it('keeps ordinary text that merely looks like a path', () => {
    expect(redactText('Users of the app saw /usr/bin/node', context)).toBe('Users of the app saw /usr/bin/node');
  });
});

describe('rotation', () => {
  const at = (minutes: number, id: string) => entry({ id, time: new Date(Date.parse('2026-11-10T10:00:00Z') + minutes * 60_000).toISOString() });
  const limits = { maxEntries: 3, maxBytes: 1_000_000, maxAgeMs: 60 * 60_000 };
  const now = Date.parse('2026-11-10T10:30:00Z');

  it('drops the oldest entries past the entry bound', () => {
    const kept = rotateEntries([at(1, 'a'), at(2, 'b'), at(3, 'c'), at(4, 'd'), at(5, 'e')], limits, now);
    expect(kept.map((e) => e.id)).toEqual(['c', 'd', 'e']);
  });

  it('drops entries older than the age bound', () => {
    const kept = rotateEntries([at(-90, 'old'), at(1, 'new')], limits, now);
    expect(kept.map((e) => e.id)).toEqual(['new']);
  });

  it('drops the oldest entries until the size bound holds, but always keeps the newest', () => {
    const big = (id: string, minutes: number) => ({ ...at(minutes, id), detail: 'x'.repeat(500) });
    const size = serializeEntry(big('a', 1)).length + 1;
    const kept = rotateEntries([big('a', 1), big('b', 2), big('c', 3)], { ...limits, maxBytes: size * 2 + 10 }, now);
    expect(kept.map((e) => e.id)).toEqual(['b', 'c']);
    expect(rotateEntries([big('a', 1)], { ...limits, maxBytes: 1 }, now).map((e) => e.id)).toEqual(['a']);
  });

  it('skips lines that are torn or not entries and reads the rest', () => {
    const good = serializeEntry(at(1, 'a'));
    const text = `${good}\n{"id":"half\nnot json\n{"id":1}\n${serializeEntry(at(2, 'b'))}\n`;
    expect(parseLog(text).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('has bounds that keep the log small', () => {
    expect(DEFAULT_LIMITS.maxBytes).toBeLessThanOrEqual(5 * 1024 * 1024);
  });
});

describe('a log written by one run is read back by the next', () => {
  it('shows the entries of the previous run after a restart, with their session', () => {
    const dir = makeLogDir();
    const first = startService(dir, makeClock());
    first.record({ source: 'editor-server', severity: 'error', message: `The VS Code server exited with code 1 near ${HOME}/x`, exitCode: 1 });
    first.markQuit();

    const second = startService(dir, makeClock(Date.parse('2026-11-11T08:00:00Z')));
    const entries = second.listing().entries;
    const old = entries.find((e) => e.exitCode === 1)!;
    expect(old.session).toBe(first.session);
    expect(old.session).not.toBe(second.session);
    expect(old.message).toBe('The VS Code server exited with code 1 near ~/x');
    expect(entries.map((e) => e.message)).toContain('Lantern quit normally');
    expect(second.pendingNotice()).toBeNull();
  });

  it('keeps the file private to the user and one entry per line', () => {
    const dir = makeLogDir();
    startService(dir);
    const file = path.join(dir, 'diagnostics', 'events.jsonl');
    expect(fs.readFileSync(file, 'utf8').trim().split('\n').every((line) => JSON.parse(line).id)).toBe(true);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o077).toBe(0);
  });

  it('compacts a log that grew past its bounds on the next start', () => {
    const dir = makeLogDir();
    const file = path.join(dir, 'diagnostics', 'events.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lines = Array.from({ length: 12 }, (_v, i) => serializeEntry(entry({ id: `e${i}`, session: 'old', time: '2026-11-10T09:00:00.000Z' })));
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    const service = startService(dir, makeClock(), { limits: { maxEntries: 5, maxBytes: 1_000_000, maxAgeMs: 86_400_000 } });
    const ids = service.listing().entries.map((e) => e.id);
    expect(ids.slice(0, 5)).toEqual(['e7', 'e8', 'e9', 'e10', 'e11']);
    expect(ids).not.toContain('e0');
    expect(fs.readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(6);
  });

  it('bounds the log while the app runs, dropping the oldest entries', () => {
    const dir = makeLogDir();
    const clock = makeClock();
    const service = startService(dir, clock, { limits: { maxEntries: 10, maxBytes: 1_000_000, maxAgeMs: 86_400_000 } });
    for (let i = 0; i < 40; i++) {
      clock.advance(1);
      service.record({ source: 'main', severity: 'warning', message: `warning number ${i}` });
    }
    const messages = service.listing().entries.map((e) => e.message);
    expect(messages.length).toBeLessThanOrEqual(13);
    expect(messages).toContain('warning number 39');
    expect(messages).not.toContain('warning number 0');
    const onDisk = parseLog(fs.readFileSync(path.join(dir, 'diagnostics', 'events.jsonl'), 'utf8'));
    expect(onDisk.length).toBeLessThanOrEqual(13);
  });
});

describe('detecting that the previous run crashed', () => {
  const run = (session: string, messages: [string, Partial<ReturnType<typeof entry>>?][]) =>
    messages.map(([message, extra], i) => entry({ id: `${session}${i}`, session, source: 'app', severity: 'info', message, ...extra }));

  it('finds nothing on the first run and after a normal quit', () => {
    expect(crashNoticeFor([], 'now')).toBeNull();
    expect(crashNoticeFor(run('prev', [['Lantern started'], [QUIT_NORMALLY.message]]), 'now')).toBeNull();
  });

  it('finds a run that started and never quit', () => {
    const notice = crashNoticeFor(run('prev', [['Lantern started']]), 'now');
    expect(notice).toMatchObject({ session: 'prev', reason: 'unclean-exit' });
  });

  it('calls a run that crashed and never quit an unclean exit', () => {
    const previous = run('prev', [['Lantern started'], ['boom', { severity: 'fatal' }]]);
    expect(crashNoticeFor(previous, 'now')).toMatchObject({ session: 'prev', reason: 'unclean-exit' });
  });

  it('still reports a crash recorded in a run that quit normally, but as a crash, not an unexpected close', () => {
    const previous = run('prev', [['Lantern started'], ['A window process is gone: crashed', { severity: 'fatal' }], [QUIT_NORMALLY.message]]);
    expect(crashNoticeFor(previous, 'now')).toMatchObject({ session: 'prev', reason: 'fatal' });
  });

  it('words the two cases differently in the log, so a window crash is never called an unexpected close', () => {
    const dir = makeLogDir();
    const first = startService(dir);
    first.record({ source: 'render-process', severity: 'fatal', message: 'A window process is gone: crashed' });
    first.markQuit();
    const second = startService(dir, makeClock(Date.parse('2026-11-11T08:00:00Z')));
    expect(second.pendingNotice()).toMatchObject({ reason: 'fatal' });
    const messages = second.listing().entries.map((e) => e.message);
    expect(messages).toContain('Lantern recorded a crash last time');
    expect(messages).not.toContain('Lantern closed unexpectedly last time');
  });

  it('looks only at the last earlier run and ignores the current one', () => {
    const previous = [...run('older', [['Lantern started']]), ...run('prev', [['Lantern started'], [QUIT_NORMALLY.message]]), ...run('now', [['Lantern started']])];
    expect(crashNoticeFor(previous, 'now')).toBeNull();
  });

  it('sets a notice and logs a warning on the next start, once', () => {
    const dir = makeLogDir();
    const first = startService(dir);
    first.record({ source: 'main', severity: 'fatal', message: 'Error: boom' });
    const second = startService(dir, makeClock(Date.parse('2026-11-11T08:00:00Z')));
    expect(second.pendingNotice()).toMatchObject({ session: first.session, reason: 'unclean-exit' });
    expect(second.listing().entries.map((e) => e.message)).toContain('Lantern closed unexpectedly last time');
    second.dismissNotice();
    expect(second.pendingNotice()).toBeNull();
    second.markQuit();
    expect(startService(dir, makeClock(Date.parse('2026-11-12T08:00:00Z'))).pendingNotice()).toBeNull();
  });
});

describe('throttling a flood of identical entries', () => {
  it('lets a few through per window and then drops the rest until the window passes', () => {
    const clock = makeClock();
    const throttle = createThrottle({ limit: 2, windowMs: 1000, now: clock.now });
    expect([throttle.allow('a'), throttle.allow('a'), throttle.allow('a'), throttle.allow('b')]).toEqual([true, true, false, true]);
    clock.advance(1001);
    expect(throttle.allow('a')).toBe(true);
  });
});
