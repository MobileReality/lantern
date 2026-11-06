const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.setPath('userData', process.env.LANTERN_GRAPH_USER_DATA);
app.commandLine.appendSwitch('lang', 'en-US');
const visible = process.env.LANTERN_GRAPH_VISIBLE === '1';
if (process.platform === 'darwin' && !visible) app.setActivationPolicy('accessory');

app.whenReady().then(async () => {
  const isDemo = process.env.LANTERN_GRAPH_FIXTURE === 'pr-review';
  const [width, height] = (process.env.LANTERN_GRAPH_VIEWPORT || (isDemo ? '1440x900' : '1100x760')).split('x').map(Number);
  const requestedDpr = Number(process.env.LANTERN_GRAPH_DPR || '1');
  const window = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: visible,
    backgroundColor: '#040d23',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== 'about:blank' && !url.startsWith(pathToFileURL(path.join(__dirname, 'index.html')).href)) event.preventDefault();
  });
  await window.loadURL('about:blank');
  const nativeDpr = await window.webContents.executeJavaScript('devicePixelRatio');
  let dprMode = 'native';
  if (nativeDpr !== requestedDpr) {
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: requestedDpr, mobile: false });
    dprMode = 'cdp-emulated';
  }
  await window.loadFile(path.join(__dirname, 'index.html'), {
    query: {
      fixture: process.env.LANTERN_GRAPH_FIXTURE || 'overview',
      dprMode,
      requestedDpr: String(requestedDpr),
      ...(process.env.LANTERN_GRAPH_PR ? { pr: process.env.LANTERN_GRAPH_PR } : {}),
      ...(process.env.LANTERN_GRAPH_FLOW ? { flow: process.env.LANTERN_GRAPH_FLOW } : {}),
    },
  });
});

app.on('window-all-closed', () => app.quit());
