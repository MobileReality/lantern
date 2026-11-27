import type { GuideNote } from './lanternguide';
import { isSelectingWithin } from './textselection';

function guideNoteBlock(note: GuideNote | undefined) {
  if (!note) return null;
  const box = document.createElement('div');
  box.className = 'lt-guide-note';
  box.dataset.careful = String(note.careful);
  const label = document.createElement('span');
  label.className = 'lt-guide-note-label';
  label.textContent = `Step ${note.at + 1} of ${note.count} · ${note.careful ? 'careful' : 'skim'}`;
  const title = document.createElement('b');
  title.className = 'lt-guide-note-title';
  title.textContent = note.title;
  const why = document.createElement('span');
  why.className = 'lt-guide-note-why';
  why.textContent = note.why;
  box.append(label, title, why);
  box.tabIndex = 0;
  box.setAttribute('role', 'button');
  box.setAttribute('aria-label', `Why this step: ${note.title} (toggle full text)`);
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

export { guideNoteBlock };
