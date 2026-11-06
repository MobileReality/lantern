import { app, BrowserWindow, ipcMain } from 'electron';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import path from 'node:path';
import { createAuth } from '@main/auth';
import { namesInProjectFiles } from '@main/auth/env-names';
import { registerAuthIpc } from '@main/auth/ipc';
import { codeHostOf } from '@main/lantern-host-origin';

const env = (name: string) => process.env[name] ?? '';

app.setPath('userData', env('LANTERN_HARNESS_USER_DATA'));
app.commandLine.appendSwitch('lang', 'en-US');
const visible = env('LANTERN_HARNESS_VISIBLE') === '1';
if (process.platform === 'darwin' && !visible) app.setActivationPolicy('accessory');

const key = randomBytes(32);
const cipher = {
  available: () => true,
  encrypt(plain: string) {
    const iv = randomBytes(12);
    const sealer = createCipheriv('aes-256-gcm', key, iv);
    const sealed = Buffer.concat([sealer.update(plain, 'utf8'), sealer.final()]);
    return Buffer.concat([iv, sealer.getAuthTag(), sealed]);
  },
  decrypt(data: Buffer) {
    const opener = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    opener.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([opener.update(data.subarray(28)), opener.final()]).toString('utf8');
  },
};

app.whenReady().then(async () => {
  const [width, height] = (env('LANTERN_HARNESS_VIEWPORT') || '1280x800').split('x').map(Number);
  const window = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: visible,
    backgroundColor: '#040d23',
    webPreferences: {
      preload: path.join(__dirname, 'integrations-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const stub = env('LANTERN_STUB_PROVIDERS');
  const auth = createAuth({
    dir: env('LANTERN_HARNESS_USER_DATA'),
    cipher,
    drivers: {},
    resolveProject: (project) => project,
    check: { endpoints: { github: stub, bitbucket: stub, jira: () => stub }, timeoutMs: 4000 },
    detectHost: (root) => codeHostOf(root),
    readFileNames: namesInProjectFiles,
    env: () => JSON.parse(env('LANTERN_HARNESS_ENV') || '{}'),
  });
  registerAuthIpc({
    ipc: ipcMain,
    fromWorkspace: (fn) => (event, ...args) => (event.sender === window.webContents ? fn(event, ...args) : undefined),
    auth,
    broadcast: (channel, payload) => window.webContents.send(channel, payload),
    isOwnFrame: () => true,
  });

  await window.loadFile(path.join(__dirname, 'integrations.html'), { query: { projects: env('LANTERN_HARNESS_PROJECTS'), window: env('LANTERN_HARNESS_WINDOW') } });
});

app.on('window-all-closed', () => app.quit());
