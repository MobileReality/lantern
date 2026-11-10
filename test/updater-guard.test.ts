import { describe, expect, it } from 'vitest';
import { type ActivityState, canInstallNow, liveParts } from '../src/main/updater/guard';
import { readProcessActivity } from '../src/main/updater/process-activity';
import type { CommandRunner } from '../src/main/memory-collect';

const IDLE: ActivityState = { sessions: [], agentRunning: false, processes: { terminals: 0, running: 0 } };

const idleWith = (change: Partial<ActivityState>): ActivityState => ({ ...IDLE, ...change });

describe('canInstallNow', () => {
  it('is true when nothing is alive', () => {
    expect(canInstallNow(IDLE)).toBe(true);
  });

  it('is true when every watched session has finished', () => {
    const sessions = [{ state: 'done' }, { state: 'failed' }, { state: 'stopped' }, { state: 'ended' }];
    expect(canInstallNow(idleWith({ sessions }))).toBe(true);
  });

  it.each(['running', 'shell', 'permission', 'idle'])('is false while a session is %s', (state) => {
    expect(canInstallNow(idleWith({ sessions: [{ state: 'done' }, { state }] }))).toBe(false);
  });

  it.each(['unknown', 'unavailable'])('is false while a session is %s, since it may still be alive', (state) => {
    expect(canInstallNow(idleWith({ sessions: [{ state }] }))).toBe(false);
  });

  it('is false while a run started by Lantern is going', () => {
    expect(canInstallNow(idleWith({ agentRunning: true }))).toBe(false);
  });

  it('is false while an editor terminal is open', () => {
    expect(canInstallNow(idleWith({ processes: { terminals: 1, running: 0 } }))).toBe(false);
  });

  it('is false while a process started through the editor is running', () => {
    expect(canInstallNow(idleWith({ processes: { terminals: 0, running: 2 } }))).toBe(false);
  });

  it('is false when the processes could not be read', () => {
    expect(canInstallNow(idleWith({ processes: null }))).toBe(false);
  });
});

describe('liveParts', () => {
  it('counts what a restart would end', () => {
    const state: ActivityState = {
      sessions: [{ state: 'running' }, { state: 'done' }, { state: 'idle' }],
      agentRunning: true,
      processes: { terminals: 2, running: 3 },
    };
    expect(liveParts(state)).toEqual({ sessions: 2, agentRunning: true, terminals: 2, running: 3, unknown: false });
  });

  it('flags unreadable processes as unknown', () => {
    expect(liveParts(idleWith({ processes: null })).unknown).toBe(true);
  });
});

const ROOT = 5000;
const SERVER = 5010;

function psTable(...rows: string[]): string {
  return rows.join('\n');
}

const BASE = [
  `${ROOT}     1 10:00 S    /Applications/Lantern.app/Contents/MacOS/Lantern`,
  `${SERVER} ${ROOT} 10:00 S    /Users/dev/.vscode/cli/serve-web/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/bin/code-server --port 9888`,
  `5011 ${SERVER} 10:00 S    /Users/dev/.vscode/cli/serve-web/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/node --type=ptyHost`,
  `5012 ${SERVER} 10:00 S    /Users/dev/.vscode/cli/serve-web/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/node --type=extensionHost --transformURIs`,
  `5013 ${SERVER} 10:00 S    /Users/dev/.vscode/cli/serve-web/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/node --type=fileWatcher`,
  `5090 ${ROOT} 00:01 R    /bin/ps -A -ww -o pid=,ppid=,etime=,stat=,command=`,
];

function runnerFor(...extra: string[]): CommandRunner {
  const table = psTable(...BASE, ...extra);
  return async () => table;
}

const activity = (run: CommandRunner, platform: NodeJS.Platform = 'darwin') =>
  readProcessActivity({ platform, supportedPlatforms: ['darwin'], run, rootPid: ROOT });

describe('readProcessActivity', () => {
  it('finds nothing alive in an editor that only runs its own machinery, and ignores its own listing', async () => {
    expect(await activity(runnerFor())).toEqual({ terminals: 0, running: 0 });
  });

  it('counts a terminal as one terminal and not as a running process', async () => {
    expect(await activity(runnerFor('5020 5011 05:00 S    /bin/zsh -il'))).toEqual({ terminals: 1, running: 0 });
  });

  it('counts a command started in a terminal as running', async () => {
    const result = await activity(runnerFor('5020 5011 05:00 S    /bin/zsh -il', '5021 5020 01:00 S    sleep 600'));
    expect(result).toEqual({ terminals: 1, running: 1 });
  });

  it('counts an agent and a test run started below Lantern as running', async () => {
    const result = await activity(
      runnerFor('5030 5012 02:00 S    /Users/dev/.vscode-server/extensions/anthropic.claude-code-2.0.0/resources/native-binary/claude --resume', '5031 5030 01:00 S    node /app/node_modules/.bin/vitest run'),
    );
    expect(result).toEqual({ terminals: 0, running: 2 });
  });

  it('does not count a short git call', async () => {
    expect(await activity(runnerFor('5040 5012 00:01 S    git status --porcelain'))).toEqual({ terminals: 0, running: 0 });
  });

  it('does not count a process that has already exited', async () => {
    expect(await activity(runnerFor('5050 5011 05:00 Z    /bin/zsh -il'))).toEqual({ terminals: 0, running: 0 });
  });

  it('answers null when Lantern is not in the process listing', async () => {
    expect(await activity(async () => '')).toBeNull();
  });

  it('answers null on a platform it cannot read', async () => {
    expect(await activity(runnerFor(), 'win32')).toBeNull();
  });
});
