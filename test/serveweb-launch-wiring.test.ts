import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CLAUDE_AND_CODEX = ['anthropic.claude-code-2.0.0', 'openai.chatgpt-1.0.0'];
const DIRECT_BIN = '/store/bin/code-server';

interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
}

const spawned: { bin: string; args: string[]; child: FakeChild }[] = [];

function fakeChild(): FakeChild {
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn((bin: string, args: string[]) => {
    const child = fakeChild();
    spawned.push({ bin, args, child });
    return child;
  }),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const fake = {
    ...actual,
    existsSync: () => true,
    readdirSync: () => CLAUDE_AND_CODEX,
    readFileSync: () => '',
    writeFileSync: () => undefined,
  };
  return { ...fake, default: fake };
});

vi.mock('../src/main/serveweb-settings', () => ({ ensureEditorSettingsFile: () => undefined }));
vi.mock('../src/main/serveweb-reclaim', () => ({ KILL_GRACE_MS: 0, reclaimPort: async () => 'free' }));
vi.mock('../src/main/serveweb-port', () => ({ choosePort: async () => 9999 }));
const probed: number[] = [];
const pageByPort: Record<number, string> = {};

vi.mock('../src/main/serveweb-probe', () => ({
  fetchServerPage: (port: number, _timeout: number, _token: string, cb: (page: string | null) => void) => {
    probed.push(port);
    cb(pageByPort[port] ?? null);
  },
}));
vi.mock('../src/main/prockill', () => ({ killChildTree: async () => undefined }));
vi.mock('../src/main/serveweb-launch', () => ({
  chooseServerCommand: vi.fn(({ reclaimIdleHosts, directLaunchFailed }: { reclaimIdleHosts: boolean; directLaunchFailed: boolean }) =>
    reclaimIdleHosts && !directLaunchFailed
      ? { kind: 'direct', bin: DIRECT_BIN, args: ['--reconnection-grace-time', '60'], commit: 'c0ffee', graceSeconds: 60 }
      : { kind: 'serve-web', bin: '/code', args: ['serve-web'], graceSeconds: null },
  ),
}));

function licence(accepted: boolean, answer = accepted) {
  const state = { accepted };
  const ask = vi.fn(async () => {
    if (answer) state.accepted = true;
    return answer;
  });
  return { consent: { accepted: () => state.accepted, ask }, ask };
}

async function startServer(reclaimIdleHosts: boolean, consent = licence(true), askLicense = false) {
  vi.resetModules();
  spawned.length = 0;
  const serveweb = await import('../src/main/serveweb');
  serveweb.start(undefined, undefined, { reclaimIdleHosts, license: consent.consent, askLicense });
  await vi.advanceTimersByTimeAsync(0);
  return serveweb;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('how the embedded server is started', () => {
  it('moves to another port and launches when a server that refuses our token holds the preferred one', async () => {
    probed.length = 0;
    pageByPort[9888] = 'other';
    const serveweb = await startServer(false);
    delete pageByPort[9888];
    expect(serveweb.status().port).toBe(9999);
    expect(spawned).toHaveLength(1);
  });

  it('launches the server binary directly and reports the grace time when idle reclaiming is on', async () => {
    const serveweb = await startServer(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].bin).toBe(DIRECT_BIN);
    expect(spawned[0].args).toContain('--reconnection-grace-time');
    expect(serveweb.status().graceSeconds).toBe(60);
  });

  it('starts `code serve-web` and reports no grace time when idle reclaiming is off', async () => {
    const serveweb = await startServer(false);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].bin).toBe('/code');
    expect(spawned[0].args).toEqual(['serve-web']);
    expect(serveweb.status().graceSeconds).toBeNull();
  });

  it('falls back to `code serve-web` and logs it when the direct server exits before it is ready', async () => {
    const serveweb = await startServer(true);
    spawned[0].child.emit('exit', 1);
    expect(spawned).toHaveLength(2);
    expect(spawned[1].bin).toBe('/code');
    expect(spawned[1].args).toEqual(['serve-web']);
    expect(serveweb.status().graceSeconds).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('starting "code serve-web" instead'));
  });

  it('falls back to `code serve-web` and logs it when the direct server cannot be spawned', async () => {
    await startServer(true);
    spawned[0].child.emit('error', new Error('spawn ENOENT'));
    expect(spawned).toHaveLength(2);
    expect(spawned[1].args).toEqual(['serve-web']);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('could not be started'));
  });
});

describe('the VS Code server licence', () => {
  it('starts nothing and asks nothing when the licence is not accepted and the start is not an open', async () => {
    const consent = licence(false);
    const serveweb = await startServer(true, consent, false);
    expect(spawned).toHaveLength(0);
    expect(consent.ask).not.toHaveBeenCalled();
    expect(serveweb.status().phase).toBe('');
  });

  it('asks on an open, and launches once the user accepts', async () => {
    const consent = licence(false, true);
    await startServer(false, consent, true);
    expect(consent.ask).toHaveBeenCalledTimes(1);
    expect(spawned).toHaveLength(1);
  });

  it('declining leaves the editor off with an error that Retry can recover from', async () => {
    const consent = licence(false, false);
    const serveweb = await startServer(false, consent, true);
    expect(spawned).toHaveLength(0);
    expect(serveweb.status().phase).toBe('error');
    consent.ask.mockImplementation(async () => {
      consent.consent.accepted = () => true;
      return true;
    });
    serveweb.recycle();
    serveweb.start(undefined, undefined, { reclaimIdleHosts: false, license: consent.consent, askLicense: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(spawned).toHaveLength(1);
  });
});

describe('the licence is asked for when the editor is first needed, not when the app opens', () => {
  async function launcher(consent: ReturnType<typeof licence>) {
    vi.resetModules();
    spawned.length = 0;
    const serveweb = await import('../src/main/serveweb');
    const { createEditorDemand } = await import('../src/main/editor-demand');
    const demand = createEditorDemand((askLicense) =>
      serveweb.start(undefined, undefined, { reclaimIdleHosts: false, license: consent.consent, askLicense }),
    );
    return { serveweb, demand };
  }

  it('neither asks nor spawns while the workspace scans, however often, until the editor is needed', async () => {
    const consent = licence(false, true);
    const { demand } = await launcher(consent);
    demand.keepWarm();
    demand.keepWarm();
    await vi.advanceTimersByTimeAsync(0);
    expect(consent.ask).not.toHaveBeenCalled();
    expect(spawned).toHaveLength(0);

    demand.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(consent.ask).toHaveBeenCalledTimes(1);
    expect(spawned).toHaveLength(1);
  });

  it('starts an already accepted server on the first need and not before', async () => {
    const consent = licence(true);
    const { demand } = await launcher(consent);
    demand.keepWarm();
    await vi.advanceTimersByTimeAsync(0);
    expect(spawned).toHaveLength(0);
    demand.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(consent.ask).not.toHaveBeenCalled();
    expect(spawned).toHaveLength(1);
  });

  it('spawns nothing after a decline, and the scan does not ask again', async () => {
    const consent = licence(false, false);
    const { demand, serveweb } = await launcher(consent);
    demand.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(spawned).toHaveLength(0);
    expect(serveweb.status().phase).toBe('error');
    demand.keepWarm();
    await vi.advanceTimersByTimeAsync(0);
    expect(consent.ask).toHaveBeenCalledTimes(1);
    expect(spawned).toHaveLength(0);
  });
});
