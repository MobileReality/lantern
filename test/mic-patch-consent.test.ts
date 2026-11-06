import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableMicrophone } from '../src/main/mic-consent';

const GUARDED = 'function x(){isSpeechToTextEnabled(){if(vscode.env.remoteName)return!1;return ok()}}';
const PATCHED = 'function x(){isSpeechToTextEnabled(){return ok()}}';

let home: string;
let extensionFile: string;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const fake = { ...actual, homedir: () => process.env.MIC_TEST_HOME as string };
  return { ...fake, default: fake };
});

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })),
}));
vi.mock('../src/main/serveweb-settings', () => ({ ensureEditorSettingsFile: () => undefined }));
vi.mock('../src/main/serveweb-reclaim', () => ({ KILL_GRACE_MS: 0, reclaimPort: async () => 'free' }));
vi.mock('../src/main/serveweb-port', () => ({ choosePort: async () => 9999 }));
vi.mock('../src/main/serveweb-probe', () => ({ fetchServerPage: (_p: number, _t: number, _k: string, cb: (page: null) => void) => cb(null) }));
vi.mock('../src/main/prockill', () => ({ killChildTree: async () => undefined }));
vi.mock('../src/main/serveweb-launch', () => ({
  chooseServerCommand: () => ({ kind: 'serve-web', bin: '/code', args: ['serve-web'], graceSeconds: null }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mic-patch-'));
  process.env.MIC_TEST_HOME = home;
  const extensions = path.join(home, '.vscode-server', 'extensions');
  for (const id of ['anthropic.claude-code-2.0.0', 'openai.chatgpt-1.0.0']) fs.mkdirSync(path.join(extensions, id), { recursive: true });
  extensionFile = path.join(extensions, 'anthropic.claude-code-2.0.0', 'extension.js');
  fs.writeFileSync(extensionFile, GUARDED);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.MIC_TEST_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

async function loadServeWeb() {
  vi.resetModules();
  return import('../src/main/serveweb');
}

describe('the microphone patch of the Claude extension', () => {
  it('leaves extension.js untouched when the embedded server starts', async () => {
    const serveweb = await loadServeWeb();
    serveweb.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fs.readFileSync(extensionFile, 'utf8')).toBe(GUARDED);
    expect(fs.existsSync(`${extensionFile}.ccm-bak`)).toBe(false);
  });

  it('patches extension.js only once the user has confirmed the warning', async () => {
    const serveweb = await loadServeWeb();
    const recycle = vi.fn();
    const enabled = await enableMicrophone({ confirm: async () => true, apply: serveweb.applyPatch, recycle });
    expect(enabled).toBe(true);
    expect(fs.readFileSync(extensionFile, 'utf8')).toBe(PATCHED);
    expect(fs.readFileSync(`${extensionFile}.ccm-bak`, 'utf8')).toBe(GUARDED);
    expect(recycle).toHaveBeenCalledOnce();
  });

  it('changes nothing when the warning is cancelled', async () => {
    const serveweb = await loadServeWeb();
    const recycle = vi.fn();
    const enabled = await enableMicrophone({ confirm: async () => false, apply: serveweb.applyPatch, recycle });
    expect(enabled).toBe(false);
    expect(fs.readFileSync(extensionFile, 'utf8')).toBe(GUARDED);
    expect(recycle).not.toHaveBeenCalled();
  });

  it('treats a warning that fails to show as a refusal', async () => {
    const apply = vi.fn();
    const enabled = await enableMicrophone({ confirm: async () => { throw new Error('no window'); }, apply, recycle: vi.fn() });
    expect(enabled).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
});
