import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;

  class FakeWindow {
    static all: FakeWindow[] = [];
    destroyed = false;
    maximized = false;
    handlers = new Map<string, Handler[]>();
    webContents = { id: FakeWindow.all.length + 1, on: vi.fn() };
    show = vi.fn();
    focus = vi.fn();
    loadFile = vi.fn();
    setSize = vi.fn();
    center = vi.fn();

    constructor(public options: Record<string, unknown>) {
      FakeWindow.all.push(this);
    }

    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }

    once(event: string, handler: Handler) {
      this.on(event, handler);
    }

    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }

    isDestroyed() {
      return this.destroyed;
    }

    isMaximized() {
      return this.maximized;
    }

    isFullScreen() {
      return false;
    }

    close() {
      this.destroyed = true;
      this.emit('closed');
    }
  }

  const dock = { show: vi.fn(), hide: vi.fn(), setIcon: vi.fn() };
  const app: { dock?: typeof dock; focus: ReturnType<typeof vi.fn>; getPath: () => string } = { focus: vi.fn(), getPath: () => os.tmpdir() };
  return { FakeWindow, app, dock, providers: new Map<string, string>() };
});

vi.mock('electron', () => ({ app: fake.app, BrowserWindow: fake.FakeWindow }));
vi.mock('../src/main/bundle', () => ({ installOnOpen: vi.fn() }));
vi.mock('../src/main/settings', () => ({
  provider: (root: string) => fake.providers.get(root) ?? 'claude',
}));

type Windows = typeof import('../src/main/windows');
type Popout = typeof import('../src/main/popout');
type Projects = typeof import('../src/main/projects');

let windows: Windows;
let popout: Popout;
let projects: Projects;
let installOnOpen: ReturnType<typeof vi.fn>;
let tmp: string;
let main: InstanceType<typeof fake.FakeWindow> | null;
const trusted = new Set<unknown>();

function repo(name: string) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sub'));
  return dir;
}

const lastWindow = () => fake.FakeWindow.all[fake.FakeWindow.all.length - 1];

function openMain() {
  main = windows.newWorkspaceWindow('Lantern') as unknown as InstanceType<typeof fake.FakeWindow>;
  main.on('closed', () => {
    main = null;
    windows.hideDockIfIdle();
  });
  return main;
}

beforeEach(async () => {
  vi.resetModules();
  fake.FakeWindow.all.length = 0;
  fake.providers.clear();
  fake.app.dock = undefined;
  fake.app.focus.mockClear();
  fake.dock.show.mockReset().mockResolvedValue(undefined);
  fake.dock.hide.mockReset();
  trusted.clear();
  main = null;
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-windows-')));
  windows = await import('../src/main/windows');
  popout = await import('../src/main/popout');
  projects = await import('../src/main/projects');
  ({ installOnOpen } = (await import('../src/main/bundle')) as unknown as { installOnOpen: ReturnType<typeof vi.fn> });
  windows.init({
    preload: '/app/preload/workspace.js',
    htmlDir: '/app/renderer',
    dockIcon: { isEmpty: () => true } as never,
    trust: (wc) => trusted.add(wc),
    untrust: (wc) => trusted.delete(wc),
    mainWindow: () => main as never,
  });
  popout.init({
    preload: '/app/preload/workspace.js',
    htmlDir: '/app/renderer',
    onCreated: (wc) => trusted.add(wc),
    onClosed: (wc) => {
      trusted.delete(wc);
      windows.hideDockIfIdle();
    },
  });
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('a project window', () => {
  it('opens once for a root, loads the page for that project and trusts only its own contents', () => {
    const root = repo('alpha');
    windows.openProjectWindow(root);
    expect(fake.FakeWindow.all).toHaveLength(1);
    const win = lastWindow();
    expect(win.options.title).toBe('alpha');
    expect(win.loadFile).toHaveBeenCalledWith('/app/renderer/workspace.html', { query: { project: root } });
    expect(trusted.has(win.webContents)).toBe(true);
    expect([...windows.projectWins.keys()]).toEqual([root]);
  });

  it('focuses the window it already has instead of opening a second one', () => {
    const root = repo('alpha');
    windows.openProjectWindow(root);
    const win = lastWindow();
    win.show.mockClear();
    win.focus.mockClear();
    windows.openProjectWindow(root);
    expect(fake.FakeWindow.all).toHaveLength(1);
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  it('takes the app to the front on macOS so the menu bar follows', () => {
    const root = repo('alpha');
    windows.openProjectWindow(root);
    windows.openProjectWindow(root);
    expect(fake.app.focus).toHaveBeenCalledTimes(process.platform === 'darwin' ? 1 : 0);
    if (process.platform === 'darwin') expect(fake.app.focus).toHaveBeenCalledWith({ steal: true });
  });

  it('shares one window between a symlink, a subfolder and the folder itself', () => {
    const root = repo('alpha');
    const alias = path.join(tmp, 'alias');
    fs.symlinkSync(root, alias);
    windows.openProjectWindow(root);
    windows.openProjectWindow(alias);
    windows.openProjectWindow(path.join(root, 'sub'));
    windows.openProjectWindow(`${root}/`);
    expect(fake.FakeWindow.all).toHaveLength(1);
    expect([...windows.projectWins.keys()]).toEqual([root]);
  });

  it('keeps separate windows for separate projects', () => {
    windows.openProjectWindow(repo('alpha'));
    windows.openProjectWindow(repo('beta'));
    expect(fake.FakeWindow.all).toHaveLength(2);
    expect(windows.projectWins.size).toBe(2);
  });

  it('is forgotten when closed, so the next open makes a new window', () => {
    const root = repo('alpha');
    windows.openProjectWindow(root);
    const first = lastWindow();
    first.close();
    expect(windows.projectWins.size).toBe(0);
    expect(trusted.has(first.webContents)).toBe(false);
    windows.openProjectWindow(root);
    expect(fake.FakeWindow.all).toHaveLength(2);
    expect(lastWindow()).not.toBe(first);
  });

  it('installs the bundle for the project assistant, Codex included', () => {
    const claude = repo('alpha');
    const codex = repo('beta');
    fake.providers.set(codex, 'codex');
    windows.openProjectWindow(claude);
    windows.openProjectWindow(codex);
    expect(installOnOpen).toHaveBeenCalledWith(claude, { provider: 'claude' });
    expect(installOnOpen).toHaveBeenCalledWith(codex, { provider: 'codex' });
  });

  it('is listed with the sidebar projects while open and never saved there', () => {
    const root = repo('alpha');
    windows.openProjectWindow(root);
    expect(projects.groups().map((g) => g.path)).toEqual([root]);
    lastWindow().close();
    expect(projects.groups()).toEqual([]);
  });

  it('is the only window whose sender owns the project', () => {
    const root = repo('alpha');
    windows.openProjectWindow(root);
    const win = lastWindow();
    const other = openMain();
    expect(windows.ownsProject(win.webContents as never, root)).toBe(true);
    expect(windows.ownsProject(other.webContents as never, root)).toBe(false);
    expect(windows.ownsProject(win.webContents as never, repo('beta'))).toBe(false);
  });

  it('is found by a session cwd inside it, for focus from a notification', () => {
    const root = repo('alpha');
    windows.openProjectWindow(root);
    const win = lastWindow();
    win.show.mockClear();
    expect(windows.focusProjectWindow(path.join(root, 'sub'), root)).toBe(true);
    expect(win.show).toHaveBeenCalled();
    expect(windows.focusProjectWindow(repo('beta'))).toBe(false);
  });
});

describe('opening from the command line arguments', () => {
  const argv = (dir: string) => ['/Applications/Lantern.app/Contents/MacOS/Lantern', `--project=${dir}`];

  it('opens a project window for --project=', () => {
    const root = repo('my project');
    const fallback = vi.fn();
    windows.openFromArgv(argv(root), '/', fallback);
    expect(fake.FakeWindow.all).toHaveLength(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('resolves a relative folder against the directory the command ran in', () => {
    const root = repo('alpha');
    windows.openFromArgv(argv('.'), root);
    windows.openFromArgv(argv('../alpha'), path.join(root, 'sub'));
    expect(fake.FakeWindow.all).toHaveLength(1);
    expect([...windows.projectWins.keys()]).toEqual([root]);
  });

  it('a second launch for the same folder, spelled through a symlink, focuses the first window', () => {
    const root = repo('alpha');
    const alias = path.join(tmp, 'alias');
    fs.symlinkSync(root, alias);
    windows.openFromArgv(argv(root), '/');
    const win = lastWindow();
    win.show.mockClear();
    windows.openFromArgv(argv(alias), '/');
    expect(fake.FakeWindow.all).toHaveLength(1);
    expect(win.show).toHaveBeenCalled();
  });

  it('falls back instead of opening a window for a missing folder or a file', () => {
    const file = path.join(tmp, 'notes.txt');
    fs.writeFileSync(file, '');
    const fallback = vi.fn();
    windows.openFromArgv(argv(path.join(tmp, 'missing')), '/', fallback);
    windows.openFromArgv(argv(file), '/', fallback);
    expect(fake.FakeWindow.all).toHaveLength(0);
    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it('falls back when there is no --project=, and does nothing without a fallback', () => {
    const fallback = vi.fn();
    windows.openFromArgv(['/Applications/Lantern.app/Contents/MacOS/Lantern'], '/', fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(() => windows.openFromArgv(['electron', '.'], '/')).not.toThrow();
    expect(fake.FakeWindow.all).toHaveLength(0);
  });
});

describe('pop-out windows', () => {
  it('close with the window that opened them and no other', () => {
    const root = repo('alpha');
    const mainWin = openMain();
    windows.openProjectWindow(root);
    const projectWin = lastWindow();
    popout.open('explain', root, mainWin.webContents as never);
    const mainPopout = lastWindow();
    popout.open('explain', root, projectWin.webContents as never);
    const projectPopout = lastWindow();

    mainWin.close();
    expect(mainPopout.destroyed).toBe(true);
    expect(projectPopout.destroyed).toBe(false);
    expect(projectWin.destroyed).toBe(false);

    projectWin.close();
    expect(projectPopout.destroyed).toBe(true);
  });
});


describe('the dock icon', () => {
  beforeEach(() => {
    fake.app.dock = fake.dock;
  });

  it('stays while any window is open and hides after the last one closes', () => {
    const mainWin = openMain();
    windows.openProjectWindow(repo('alpha'));
    const projectWin = lastWindow();
    mainWin.close();
    expect(fake.dock.hide).not.toHaveBeenCalled();
    projectWin.close();
    expect(fake.dock.hide).toHaveBeenCalledTimes(1);
  });
});

describe('the window-open handler of web contents', () => {
  it.each(['https://auth.openai.com/login?x=1', 'http://localhost:1455/auth', 'HTTPS://Example.com'])('hands %s to the browser and denies the window', (url) => {
    const openExternal = vi.fn();
    expect(windows.windowOpenHandler(openExternal)({ url })).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(url);
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'vscode://vscode.github-authentication/did-authenticate', 'custom-scheme://x', 'about:blank', '/relative', ''])('opens nothing for %s and still denies the window', (url) => {
    const openExternal = vi.fn();
    expect(windows.windowOpenHandler(openExternal)({ url })).toEqual({ action: 'deny' });
    expect(openExternal).not.toHaveBeenCalled();
  });
});
