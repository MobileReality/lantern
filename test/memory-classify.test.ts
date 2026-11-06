import { describe, expect, it } from 'vitest';
import { classifyProcess } from '../src/main/memory-classify';
import { parsePsAged } from '../src/main/memory-parse';
import { ROOT_PID, fixture } from './helpers/memory-fixtures';

const rows = parsePsAged(fixture('ps-aged.txt'));
const identityOf = (pid: number) => {
  const row = rows.find((r) => r.pid === pid)!;
  return classifyProcess(row.command, { pid: row.pid, ppid: row.ppid, rootPid: ROOT_PID });
};
const pick = (pid: number) => {
  const { category, kind, label } = identityOf(pid);
  return { category, kind, label };
};

describe('categories and kinds on a recorded process table', () => {
  it('puts Lantern and its Electron helpers in the app category', () => {
    expect(pick(4000)).toEqual({ category: 'app', kind: 'main', label: 'main' });
    expect(pick(4001)).toMatchObject({ category: 'app', kind: 'gpu' });
    expect(pick(4002)).toMatchObject({ category: 'app', kind: 'utility' });
    expect(pick(4003)).toMatchObject({ category: 'app', kind: 'renderer' });
  });

  it('puts the VS Code server chain and its hosts in the editor category', () => {
    for (const pid of [4010, 4011, 4012, 4013, 4014]) expect(pick(pid)).toMatchObject({ category: 'editor', kind: 'server' });
    expect(pick(4020)).toEqual({ category: 'editor', kind: 'extension-host', label: 'extensionHost' });
    expect(pick(4024)).toEqual({ category: 'editor', kind: 'watcher', label: 'fileWatcher' });
    expect(pick(4022)).toEqual({ category: 'editor', kind: 'tsserver', label: 'tsserver.js' });
  });

  it('names an extension process by its extension, without version or platform', () => {
    expect(pick(4025)).toEqual({ category: 'editor', kind: 'extension', label: 'json-language-features' });
  });

  it('puts claude and codex binaries in the agents category', () => {
    expect(pick(4021)).toEqual({ category: 'agents', kind: 'claude', label: 'claude' });
    expect(pick(4023)).toEqual({ category: 'agents', kind: 'codex', label: 'codex' });
  });

  it('puts everything else under other children, by what it is', () => {
    expect(pick(4030)).toMatchObject({ category: 'other', kind: 'shell', label: 'zsh' });
    expect(pick(4031)).toEqual({ category: 'other', kind: 'test', label: 'jest' });
    expect(pick(4032)).toMatchObject({ category: 'other', kind: 'test' });
    expect(pick(4050)).toEqual({ category: 'other', kind: 'dev-server', label: 'vite.js' });
    expect(pick(4051)).toEqual({ category: 'other', kind: 'git', label: 'git' });
  });
});

describe('edge cases', () => {
  const classify = (command: string, position = { pid: 5000, ppid: 4999, rootPid: ROOT_PID }) => classifyProcess(command, position);

  it('does not treat a shell that merely mentions claude as an agent', () => {
    expect(classify("zsh -c 'claude --resume'")).toMatchObject({ category: 'other', kind: 'shell' });
  });

  it('recognises the npm-installed claude CLI as an agent', () => {
    expect(classify('node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js')).toMatchObject({ category: 'agents', kind: 'claude' });
  });

  it('treats an Electron helper as Lantern only when Lantern started it', () => {
    const helper = '/Apps/Other.app/Contents/Frameworks/Other Helper (Renderer).app/Contents/MacOS/Other Helper (Renderer) --type=renderer';
    expect(classify(helper, { pid: 5000, ppid: ROOT_PID, rootPid: ROOT_PID }).category).toBe('app');
    expect(classify(helper, { pid: 5000, ppid: 4999, rootPid: ROOT_PID }).category).toBe('other');
  });

  it('does not call a project folder named vite a dev server', () => {
    expect(classify('node /Users/dev/vite-tutorial/server.js')).toMatchObject({ kind: 'node', label: 'server.js' });
  });

  it('classifies a login shell by its name', () => {
    expect(classify('-zsh')).toMatchObject({ kind: 'shell' });
  });
});

describe('privacy of the label', () => {
  const classify = (command: string) => classifyProcess(command, { pid: 5000, ppid: 4999, rootPid: ROOT_PID });

  it('never carries arguments, tokens or session ids', () => {
    for (const pid of rows.map((r) => r.pid)) {
      const { label } = identityOf(pid);
      expect(label).not.toMatch(/resume|7e166f5d|--|=|\s/);
      expect(label.length).toBeLessThanOrEqual(32);
    }
  });

  it('does not use inline code as a label', () => {
    expect(classify(`node -e require('x')(process.env.TOKEN)`).label).toBe('node');
    expect(classify('node -p process.env.SECRET_TOKEN').label).toBe('node');
  });

  it('falls back to the executable when the script token is not a plain path', () => {
    expect(classify('python3 https://user:secret@host/x.py').label).toBe('python3');
  });
});
