import { byId } from '../lib/util';
import { renderMemory } from '../lib/memoryview';

const modal = byId('memory-modal');
const body = byId('memory-body');
const closeButton = byId('memory-close');
let isOpen = false;
let isListening = false;
let returnFocus: HTMLElement | null = null;

function listenForUpdates() {
  if (isListening) return;
  isListening = true;
  window.ccmws.onMemoryUpdate((snapshot) => {
    if (isOpen) renderMemory(body, { supported: true, snapshot });
  });
}

async function openMemory() {
  if (isOpen) return;
  isOpen = true;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modal.classList.remove('hidden');
  renderMemory(body, null);
  closeButton.focus();
  listenForUpdates();
  const state = await window.ccmws.memoryWatch(true);
  if (isOpen) renderMemory(body, state);
}

function closeMemory() {
  if (!isOpen) return;
  isOpen = false;
  modal.classList.add('hidden');
  body.replaceChildren();
  void window.ccmws.memoryWatch(false);
  returnFocus?.focus();
  returnFocus = null;
}

closeButton.addEventListener('click', closeMemory);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeMemory();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isOpen) closeMemory();
});

export { openMemory };
