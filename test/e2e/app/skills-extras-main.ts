import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { registerExtensionsIpc } from '@main/extensions-ipc';
import * as skills from '@main/skills';

const env = (name: string) => process.env[name] ?? '';

app.setPath('userData', env('LANTERN_HARNESS_USER_DATA'));
app.commandLine.appendSwitch('lang', 'en-US');
const visible = env('LANTERN_HARNESS_VISIBLE') === '1';
if (process.platform === 'darwin' && !visible) app.setActivationPolicy('accessory');

app.whenReady().then(async () => {
  const [width, height] = (env('LANTERN_HARNESS_VIEWPORT') || '1280x800').split('x').map(Number);
  const home = env('LANTERN_HARNESS_HOME');
  const project = env('LANTERN_HARNESS_PROJECT');
  const window = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: visible,
    backgroundColor: '#040d23',
    webPreferences: { preload: path.join(__dirname, 'skills-extras-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const fromWorkspace = (fn: (event: any, ...args: any[]) => unknown) => (event: any, ...args: any[]) => (event.sender === window.webContents ? fn(event, ...args) : undefined);
  const installedFor = (target: unknown) => skills.installedNames(typeof target === 'string' && target ? target : null, 'claude', home);

  ipcMain.handle('skills:list', fromWorkspace((_event, target) => skills.listFor(target)));
  ipcMain.handle(
    'skills:link',
    fromWorkspace((_event, request) => {
      const linkResults = skills.link(request.project, request.names);
      return { ...skills.listFor(request.project), linkResults };
    }),
  );
  ipcMain.handle(
    'skills:unlink',
    fromWorkspace((_event, request) => {
      skills.unlink(request.project, request.names);
      return skills.listFor(request.project);
    }),
  );
  registerExtensionsIpc({
    handle: (channel, handler) => ipcMain.handle(channel, handler),
    fromWorkspace,
    installedFor,
    reinstallFor: () => null,
    syncPermissionsFor: () => null,
    pickList: async () => env('LANTERN_HARNESS_IMPORT') || null,
    home,
  });

  await window.loadFile(path.join(__dirname, 'skills-extras.html'), { query: { project } });
});

app.on('window-all-closed', () => app.quit());
