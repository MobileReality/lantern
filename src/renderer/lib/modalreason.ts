import { isSelectingWithin } from './textselection';

function reasonBlock(reason: string | undefined) {
  const text = reason?.trim();
  if (!text) return null;
  const box = document.createElement('div');
  box.className = 'lt-modal-reason';
  box.dataset.tip = text;
  const label = document.createElement('span');
  label.className = 'lt-reason-label';
  label.textContent = 'Reason';
  const body = document.createElement('span');
  body.className = 'lt-reason-text';
  body.textContent = text;
  box.append(label, body);
  box.tabIndex = 0;
  box.setAttribute('role', 'button');
  box.setAttribute('aria-label', 'Why this file changed (toggle full text)');
  const toggle = () => {
    if (!isSelectingWithin(box)) box.classList.toggle('open');
  };
  box.addEventListener('click', toggle);
  box.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    toggle();
  });
  return box;
}

export { reasonBlock };
