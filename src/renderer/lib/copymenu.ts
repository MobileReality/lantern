import { mountPopover, rovingFocus } from '@renderer/popover';

interface CopyEntry {
  label: string;
  text: string;
  done: string;
}

function pointAnchor(host: HTMLElement, at: { x: number; y: number }) {
  const point = document.createElement('span');
  point.className = 'lt-copy-point';
  point.style.left = `${at.x}px`;
  point.style.top = `${at.y}px`;
  host.append(point);
  return point;
}

function openCopyMenu(trigger: HTMLElement, host: HTMLElement, entries: CopyEntry[], copy: (entry: CopyEntry) => void, at?: { x: number; y: number }) {
  const menu = document.createElement('ul');
  menu.className = 'lt-copy-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Copy');
  for (const entry of entries) {
    const li = document.createElement('li');
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'lt-copy-item';
    item.setAttribute('role', 'menuitem');
    item.textContent = entry.label;
    item.addEventListener('click', () => {
      popover.close(true);
      copy(entry);
    });
    li.append(item);
    menu.append(li);
  }
  host.append(menu);
  const point = at ? pointAnchor(host, at) : null;
  const popover = mountPopover(trigger, menu, {
    placement: 'bottom-start',
    anchor: point ?? trigger,
    bindClick: false,
    focus: () => menu.querySelector<HTMLElement>('.lt-copy-item'),
    onClose: () => {
      popover.dispose();
      menu.remove();
      point?.remove();
    },
  });
  rovingFocus(menu, () => [...menu.querySelectorAll<HTMLElement>('.lt-copy-item')]);
  popover.open();
  return popover;
}

export { openCopyMenu };
export type { CopyEntry };
