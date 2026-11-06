import { mountTrayPopover } from '@renderer/lib/tray-popover-view';

const calls: string[] = [];

const bridge = {
  resize: (height: number) => parent.postMessage({ type: 'resize', height }, '*'),
  close: () => calls.push('close'),
  openProject: (projectPath: string) => calls.push(`open:${projectPath}`),
  run: (id: string) => calls.push(`run:${id}`),
};

Object.assign(window, { __calls: calls, __tray: mountTrayPopover(document.getElementById('pop') as HTMLElement, bridge) });
document.documentElement.dataset.harnessReady = 'true';
