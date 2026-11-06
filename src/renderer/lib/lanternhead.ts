import type { LanternLanguage } from '../../main/lantern';

function languageName(code: string) {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function langSwitch(language: LanternLanguage, onChange: (code: string) => void): HTMLSelectElement | null {
  if (language.available.length < 2) return null;
  const select = document.createElement('select');
  select.className = 'lt-lang';
  select.dataset.tip = 'Language of the map texts';
  select.setAttribute('aria-label', 'Language of the map texts');
  for (const code of language.available) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = languageName(code);
    opt.selected = code === language.code;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function syncLang(previous: HTMLSelectElement | null, anchor: HTMLElement, language: LanternLanguage, onChange: (code: string) => void) {
  previous?.remove();
  const next = langSwitch(language, onChange);
  if (next) anchor.after(next);
  return next;
}

export { syncLang };
