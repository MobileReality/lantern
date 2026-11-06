// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTrayPopover } from '../src/renderer/lib/tray-popover-view';
import { trayActionId } from '../src/shared/tray-action';
import { manyGroups, model, quietGroups } from './fixtures/tray-groups';

const bridge = () => ({ resize: vi.fn(), close: vi.fn(), openProject: vi.fn(), run: vi.fn() });

let root: HTMLElement;
let b: ReturnType<typeof bridge>;
let view: ReturnType<typeof mountTrayPopover>;

const q = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
const all = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];
const keydown = (key: string, init: KeyboardEventInit = {}) => (document.activeElement ?? root).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = '<main id="pop" tabindex="-1"></main>';
  root = document.getElementById('pop') as HTMLElement;
  b = bridge();
  view = mountTrayPopover(root, b);
});

describe('what the popover draws', () => {
  it('names itself, shows the brand and how many sessions need you', () => {
    view.open(model(manyGroups()), 600);
    expect(root.getAttribute('aria-label')).toBe('Lantern sessions');
    expect(q('.title').textContent).toBe('Lantern');
    expect(q('.pill').textContent).toBe('4 need you');
    expect(q('.summary').getAttribute('aria-live')).toBe('polite');
  });

  it('says one session needs you in the singular', () => {
    view.open(model([{ name: 'p', path: '/w/p', sessions: [{ state: 'idle', provider: 'claude' }] }]), 600);
    expect(q('.pill').textContent).toBe('1 needs you');
  });

  it('says nothing needs you when only work and finished projects exist', () => {
    view.open(model(quietGroups()), 600);
    expect(q('.pill').textContent).toBe('Nothing needs you');
  });

  it('groups the projects into labelled sections, most urgent first', () => {
    view.open(model(manyGroups()), 600);
    expect(all('.group').map((group) => group.getAttribute('aria-labelledby'))).toEqual(['tray-section-needs', 'tray-section-working', 'tray-section-finished', 'tray-section-other']);
    expect(all('.group .eyebrow > span:first-child').map((node) => node.textContent)).toEqual(['Needs you', 'Working', 'Finished', 'Other']);
    expect(all('.group[data-section="needs"] .name').map((node) => node.textContent)).toEqual(['shop-frontend', 'payments-api', 'ledger']);
  });

  it('draws each row with its state in words, its path tail and a drawn indicator, no emoji', () => {
    view.open(model(manyGroups()), 600);
    const row = q('.row');
    expect(row.dataset.tone).toBe('permission');
    expect(row.querySelector('.state .label')!.textContent).toBe('needs approval');
    expect(row.querySelector('.tail')!.textContent).toBe('~/…/clients/acme');
    expect(row.querySelector('.mark svg')).not.toBeNull();
    expect(root.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('shows how many sessions share the state and reads them out in the label', () => {
    view.open(model(manyGroups()), 600);
    const failed = all('.row').find((row) => row.querySelector('.name')!.textContent === 'payments-api')!;
    expect(failed.querySelector('.n')!.textContent).toBe('2');
    expect(failed.getAttribute('aria-label')).toBe('payments-api, failed, 2 sessions, ~/GIT/clients');
  });

  it('cuts a very long path tail in the middle', () => {
    view.open(model([{ name: 'p', path: `/${'a'.repeat(40)}/${'b'.repeat(40)}/p`, sessions: [{ state: 'running', provider: 'claude' }] }]), 600);
    const tail = q('.tail').textContent!;
    expect(tail.length).toBeLessThanOrEqual(36);
    expect(tail).toContain('…');
  });

  it('passes the most urgent state to the page so the pill can take its colour', () => {
    view.open(model(manyGroups()), 600);
    expect(document.body.dataset.tone).toBe('permission');
  });

  it('shows the real Lantern logo in the header, in the colours of the app icon and whatever the state', () => {
    const rgb = (name: string) => {
      const [r, g, b] = new RegExp(`const ${name} = \\[(\\d+), (\\d+), (\\d+)\\]`).exec(icon)!.slice(1).map(Number);
      return `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
    };
    const icon = readFileSync(path.resolve(__dirname, '../scripts/make-icon.js'), 'utf8');
    view.open(model(manyGroups()), 600);
    const logo = q('.head .logo svg').outerHTML.toLowerCase();
    for (const name of ['NAVY', 'RED', 'WARM_GLOW', 'WARM_CORE']) expect(logo, name).toContain(rgb(name));
    view.open(model([]), 600);
    expect(q('.head .logo svg').outerHTML.toLowerCase()).toBe(logo);
  });

  it('shows an empty state with no project rows and nothing to clear', () => {
    view.open(model([]), 600);
    expect(q('.empty-title').textContent).toBe('No projects yet');
    expect(all('.row')).toHaveLength(0);
    expect(root.querySelector('.pill')).toBeNull();
    expect(all('button').map((button) => button.textContent)).toEqual(['Open workspace', '']);
  });

  it('reports its height so the window can fit it, and caps it at the room it was given', () => {
    view.open(model(manyGroups()), 480);
    expect(b.resize).toHaveBeenCalled();
    expect(root.style.getPropertyValue('--max-h')).toBe('480px');
  });
});

describe('the footer', () => {
  it('offers Open workspace, Clear finished only when there is something finished, and More', () => {
    view.open(model(manyGroups()), 600);
    expect(all('.foot button').map((button) => button.dataset.key)).toEqual(['action:workspace', 'action:clear', 'action:more']);
    view.update(model([{ name: 'p', path: '/w/p', sessions: [{ state: 'running', provider: 'claude' }] }]));
    expect(all('.foot button').map((button) => button.dataset.key)).toEqual(['action:workspace', 'action:more']);
  });

  it('runs the workspace and clear actions', () => {
    view.open(model(manyGroups()), 600);
    q('[data-key="action:workspace"]').click();
    q('[data-key="action:clear"]').click();
    expect(b.run.mock.calls).toEqual([[trayActionId({ type: 'workspace' })], [trayActionId({ type: 'clear' })]]);
  });

  it('keeps Test notification and Quit behind More, and More is a labelled disclosure', () => {
    view.open(model(manyGroups()), 600);
    const more = q('[data-key="action:more"]');
    expect(more.getAttribute('aria-label')).toBe('More');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('.more')).toBeNull();
    more.click();
    expect(q('[data-key="action:more"]').getAttribute('aria-expanded')).toBe('true');
    expect(all('.more .test').map((button) => button.textContent)).toEqual(['Done', 'Waiting for you', 'Needs permission', 'Failed']);
    expect(q('.more .quit').textContent).toBe('Quit Lantern');
  });

  it('leaves the test cards out when notifications are off', () => {
    view.open(model(manyGroups(), false), 600);
    q('[data-key="action:more"]').click();
    expect(all('.more .test')).toHaveLength(0);
    expect(q('.more .quit')).not.toBeNull();
  });

  it('fires a test card and quits from the More items', () => {
    view.open(model(manyGroups()), 600);
    q('[data-key="action:more"]').click();
    q('[data-key="action:test:permission"]').click();
    q('[data-key="action:quit"]').click();
    expect(b.run.mock.calls).toEqual([['test:permission'], ['quit']]);
  });
});

describe('picking a project', () => {
  it('opens the project of the clicked row', () => {
    view.open(model(manyGroups()), 600);
    q('.row').click();
    expect(b.openProject).toHaveBeenCalledWith('/Users/ada/GIT/clients/acme/shop-frontend');
  });
});

describe('the keyboard', () => {
  it('starts with nothing selected and focuses the popover itself', () => {
    view.open(model(manyGroups()), 600);
    expect(document.activeElement).toBe(root);
    expect(all('.is-active')).toHaveLength(0);
  });

  it('moves the selection and the focus with the arrow keys', () => {
    view.open(model(manyGroups()), 600);
    keydown('ArrowDown');
    expect(document.activeElement).toBe(all('button[data-key]')[0]);
    keydown('ArrowDown');
    expect(document.activeElement).toBe(all('button[data-key]')[1]);
    expect(all('.is-active')).toEqual([all('button[data-key]')[1]]);
    keydown('ArrowUp');
    expect(document.activeElement).toBe(all('button[data-key]')[0]);
    expect(root.dataset.input).toBe('key');
  });

  it('wraps from the footer back to the first row and from the first row to the footer', () => {
    view.open(model(manyGroups()), 600);
    const items = all('button[data-key]');
    keydown('ArrowUp');
    expect(document.activeElement).toBe(items[items.length - 1]);
    keydown('ArrowDown');
    expect(document.activeElement).toBe(items[0]);
  });

  it('opens the selected project on Enter', () => {
    view.open(model(manyGroups()), 600);
    keydown('ArrowDown');
    keydown('ArrowDown');
    keydown('Enter');
    expect(b.openProject).toHaveBeenCalledWith('/Users/ada/GIT/clients/payments-api');
  });

  it('does nothing on Enter before anything is selected', () => {
    view.open(model(manyGroups()), 600);
    keydown('Enter');
    expect(b.openProject).not.toHaveBeenCalled();
    expect(b.run).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    view.open(model(manyGroups()), 600);
    keydown('Escape');
    expect(b.close).toHaveBeenCalledTimes(1);
  });

  it('closes the More items first on Escape and puts the selection back on More', () => {
    view.open(model(manyGroups()), 600);
    q('[data-key="action:more"]').click();
    keydown('Escape');
    expect(root.querySelector('.more')).toBeNull();
    expect(b.close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(q('[data-key="action:more"]'));
    keydown('Escape');
    expect(b.close).toHaveBeenCalledTimes(1);
  });

  it('lets the arrow keys reach the More items below the footer', () => {
    view.open(model(manyGroups()), 600);
    q('[data-key="action:more"]').click();
    keydown('ArrowDown');
    expect((document.activeElement as HTMLElement).dataset.key).toBe('action:test:done');
  });

  it('makes the row under the pointer the selected one', () => {
    view.open(model(manyGroups()), 600);
    const second = all('.row')[1];
    second.dispatchEvent(new Event('pointermove', { bubbles: true }));
    expect(second.classList.contains('is-active')).toBe(true);
    expect(root.dataset.input).toBe('pointer');
    expect(document.activeElement).toBe(second);
  });
});

describe('a state change while it is open', () => {
  it('redraws the rows and the summary', () => {
    view.open(model(manyGroups()), 600);
    view.update(model(manyGroups().slice(1)));
    expect(q('.pill').textContent).toBe('3 need you');
    expect(all('.row .name').map((node) => node.textContent)).not.toContain('shop-frontend');
  });

  it('keeps the selection on the same project when others move around it', () => {
    view.open(model(manyGroups()), 600);
    keydown('ArrowDown');
    keydown('ArrowDown');
    const key = document.activeElement!.getAttribute('data-key');
    view.update(model(manyGroups().slice(1)));
    expect(document.activeElement!.getAttribute('data-key')).toBe(key);
    expect(all('.is-active')).toHaveLength(1);
  });

  it('keeps the More items open', () => {
    view.open(model(manyGroups()), 600);
    q('[data-key="action:more"]').click();
    view.update(model(manyGroups()));
    expect(root.querySelector('.more')).not.toBeNull();
  });

  it('reports the new height after every change', () => {
    view.open(model(manyGroups()), 600);
    const calls = b.resize.mock.calls.length;
    view.update(model([]));
    expect(b.resize.mock.calls.length).toBe(calls + 1);
  });

  it('starts from a closed More and no selection when it is opened again', () => {
    view.open(model(manyGroups()), 600);
    q('[data-key="action:more"]').click();
    keydown('ArrowDown');
    view.open(model(manyGroups()), 600);
    expect(root.querySelector('.more')).toBeNull();
    expect(all('.is-active')).toHaveLength(0);
  });
});
