import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { readProjectFile } from '../../../src/main/filecontent';
import { SemanticService } from '../../../src/main/lsp/semantic-service';
import { issueSource } from '../../../src/main/lsp/source-provenance';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const project = process.env.LANTERN_LSP_PROJECT!;
const runtime = process.env.LANTERN_LSP_RUNTIME!;
const preload = process.env.LANTERN_LSP_PRELOAD!;
const userData = process.env.LANTERN_LSP_USER_DATA!;
app.setPath('userData', userData);

app.whenReady().then(async () => {
  const service = new SemanticService(runtime);
  ipcMain.handle('project:read-file', (_event, { project: requested, file }) => requested === project ? readProjectFile(project, file) : { exists: false, text: '', truncated: 0 });
  ipcMain.handle('code:semantic-highlight', (_event, request) => request.project === project ? service.highlight(request) : { ok: false, source: request.source, spans: [] });
  ipcMain.handle('lantern:pr-file-diff', (_event, { project: requested, file }) => {
    if (requested !== project) return { ok: false, diff: '', truncated: false, binary: false };
    const before = process.env.LANTERN_LSP_BEFORE!;
    const current = readProjectFile(project, file);
    const diff = execFileSync('git', ['diff', '--no-color', '--unified=100000', before, '--', file], { cwd: project, encoding: 'utf8' });
    return { ok: true, diff, truncated: false, binary: false, oldSource: issueSource(fs.realpathSync(project), file, { kind: 'revision', revision: before, contentHash: '' }), newSource: current.source };
  });
  const window = new BrowserWindow({ show: false, width: 820, height: 420, webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false } });
  await window.loadFile(path.join(__dirname, 'index.html'));
  if (process.env.LANTERN_LSP_SHOW) window.show();
  else if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    service.dispose().finally(() => app.quit());
  });
});

app.on('window-all-closed', () => app.quit());
