import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('overlay', {
  onCard: (cb: (card: unknown) => void) => ipcRenderer.on('overlay:card', (_e, card) => cb(card)),
  open: (card: unknown) => ipcRenderer.send('overlay:open', card),
  jump: (card: unknown) => ipcRenderer.send('overlay:jump', card),
  resize: (height: number) => ipcRenderer.send('overlay:resize', height),
  animate: (direction: 'in' | 'out', still: boolean) => ipcRenderer.send('overlay:animate', direction, still),
  setInteractive: (on: boolean) => ipcRenderer.send('overlay:interactive', on),
});
