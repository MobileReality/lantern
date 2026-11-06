const SELECT = '.project-select';
const PROJECT_SELECT = '.project-row .project-select';

export function bindProjectListKeys(filter: HTMLInputElement, list: HTMLElement, onFilterChange: () => void) {
  const selects = () => [...list.querySelectorAll<HTMLElement>(SELECT)];

  filter.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      list.querySelector<HTMLElement>(PROJECT_SELECT)?.click();
    } else if (event.key === 'ArrowDown') {
      selects()[0]?.focus();
    } else if (event.key === 'Escape' && filter.value) {
      filter.value = '';
      onFilterChange();
    } else {
      return;
    }
    event.preventDefault();
  });

  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const current = selects().indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    event.preventDefault();
    const next = current + (event.key === 'ArrowDown' ? 1 : -1);
    if (next < 0) filter.focus();
    else selects()[Math.min(next, selects().length - 1)].focus();
  });
}
