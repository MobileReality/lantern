import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('trayPopover', {
  onOpen: (cb: (open: unknown) => void) => ipcRenderer.on('tray:open', (_e, open) => cb(open)),
  onModel: (cb: (model: unknown) => void) => ipcRenderer.on('tray:model', (_e, model) => cb(model)),
  resize: (height: number) => ipcRenderer.send('tray:resize', height),
  close: () => ipcRenderer.send('tray:close'),
  openProject: (projectPath: string) => ipcRenderer.send('tray:open-project', projectPath),
  run: (id: string) => ipcRenderer.send('tray:action', id),
});
