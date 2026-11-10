import { byId } from '../lib/util';
import { createDiagnosticsView } from '../lib/diagnosticsview';

const modal = byId('diagnostics-modal');
const body = byId('diagnostics-body');
const closeButton = byId('diagnostics-close');
const view = createDiagnosticsView(body, {
  copy: (entryId) => window.ccmws.diagnosticsCopy(entryId ? { entryId } : {}),
  github: (entryId) => window.ccmws.diagnosticsGithub(entryId ? { entryId } : {}),
});
let isOpen = false;
let isListening = false;
let returnFocus: HTMLElement | null = null;

function listenForUpdates() {
  if (isListening) return;
  isListening = true;
  window.ccmws.onDiagnosticsUpdate((entry) => {
    if (isOpen) view.addEntry(entry);
  });
}

async function openDiagnostics() {
  if (isOpen) return;
  isOpen = true;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modal.classList.remove('hidden');
  view.setStatus('');
  closeButton.focus();
  listenForUpdates();
  const listing = await window.ccmws.diagnosticsWatch(true);
  if (isOpen) view.setListing(listing);
}

function closeDiagnostics() {
  if (!isOpen) return;
  isOpen = false;
  modal.classList.add('hidden');
  void window.ccmws.diagnosticsWatch(false);
  returnFocus?.focus();
  returnFocus = null;
}

closeButton.addEventListener('click', closeDiagnostics);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeDiagnostics();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isOpen) closeDiagnostics();
});

export { openDiagnostics };
