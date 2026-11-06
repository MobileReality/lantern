const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.setPath('userData', process.env.LANTERN_HARNESS_USER_DATA);
app.commandLine.appendSwitch('lang', 'en-US');
const visible = process.env.LANTERN_HARNESS_VISIBLE === '1';
if (process.platform === 'darwin' && !visible) app.setActivationPolicy('accessory');

app.whenReady().then(async () => {
  const [width, height] = (process.env.LANTERN_HARNESS_VIEWPORT || '460x820').split('x').map(Number);
  const window = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: visible,
    backgroundColor: '#0b1226',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await window.loadFile(path.join(__dirname, 'tray-popover.html'));
});

app.on('window-all-closed', () => app.quit());
