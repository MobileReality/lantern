import { LOAD_STEPS, formatElapsed, type LoadView } from '../lib/editorload';
import { el } from '../lib/util';

const LANTERN_SVG = `<svg class="ls-mark" viewBox="0 0 26 30" fill="none" aria-hidden="true">
  <path class="ls-frame" d="M8 6 Q13 1.5 18 6" stroke-width="1.6" stroke-linecap="round" />
  <rect class="ls-frame-fill" x="8" y="5.4" width="10" height="3" rx="1.3" />
  <rect class="ls-frame ls-glass" x="6.4" y="9.4" width="13.2" height="14.2" rx="3.4" stroke-width="1.6" />
  <path class="ls-flame" d="M13 12.4 C15.5 15.1 15.5 18.7 13 19.5 C10.5 18.7 10.5 15.1 13 12.4 Z" />
  <rect class="ls-frame-fill" x="9" y="23.6" width="8" height="3" rx="1.2" />
</svg>`;

export interface LoadScreen {
  el: HTMLElement;
  render(view: LoadView, elapsedMs: number): void;
  setBusy(busy: boolean): void;
}

export function createLoadScreen(onRetry: () => void): LoadScreen {
  const root = el('div', 'ls');
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  const card = el('div', 'ls-card');
  const mark = el('div', 'ls-mark-wrap');
  mark.innerHTML = LANTERN_SVG;
  const title = el('h2', 'ls-title');
  const detail = el('p', 'ls-detail');
  const steps = el('ol', 'ls-steps');
  const stepEls = LOAD_STEPS.map((label) => {
    const li = el('li', 'ls-step');
    li.textContent = label;
    steps.append(li);
    return li;
  });
  const bar = el('div', 'ls-bar');
  const fill = el('div', 'ls-fill');
  bar.append(fill);
  const hint = el('p', 'ls-hint');
  const elapsed = el('span', 'ls-elapsed');
  elapsed.setAttribute('aria-hidden', 'true');
  const retry = el('button', 'ls-retry');
  retry.type = 'button';
  retry.textContent = 'Retry';
  retry.addEventListener('click', onRetry);
  card.append(mark, title, detail, steps, bar, hint, elapsed, retry);
  root.append(card);

  function render(view: LoadView, elapsedMs: number) {
    root.classList.toggle('failed', view.failed);
    title.textContent = view.title;
    detail.textContent = view.detail;
    hint.textContent = view.hint;
    stepEls.forEach((li, i) => {
      li.classList.toggle('done', i < view.step);
      li.classList.toggle('current', i === view.step);
    });
    const hasPercent = view.percent !== null && !view.failed;
    bar.classList.toggle('hidden', !hasPercent);
    fill.style.width = hasPercent ? `${view.percent}%` : '0';
    elapsed.textContent = view.failed ? '' : formatElapsed(elapsedMs);
  }

  function setBusy(busy: boolean) {
    retry.disabled = busy;
  }

  return { el: root, render, setBusy };
}
