// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { LanternPr } from '../src/main/lantern';
import { parsePrRecord } from '../src/main/lantern-pr-parse';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node, pr } from './helpers/lantern-map';

const HEAD = '3f9a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c';
const HEADER = ['lantern-pr 1', '# 7', '#title t', '#url https://x.test/7', '#branch b', '#base main', '#opened 2026-09-30', `#head ${HEAD}`];
const SHORT = ['#describe what Admins can refund orders.', '#describe before Refunds went through support.', '#describe after The refund button refunds in one click.', '#describe verified Order tests pass.'];
const mounted: ReturnType<typeof mountLanternView>[] = [];

afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  document.body.replaceChildren();
});

function card(lines: string[]): HTMLElement {
  const parsed = parsePrRecord(`${[...HEADER, ...lines].join('\n')}\n`, '7.pr');
  if (!parsed.pr) throw new Error(parsed.error);
  const record: LanternPr = pr('7', { ...parsed.pr, summary: parsed.pr.summary ?? undefined, files: [] });
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, mapOf({ nodes: [node('src/a.ts', 'service')], prs: [record] }), { pr: '7' }));
  return root.querySelector('.pr-head') as HTMLElement;
}

const titles = (head: HTMLElement) => [...head.querySelectorAll('.pr-desc-title')].map((h) => h.textContent);

describe('pull request card: description', () => {
  it('shows the three sections under the title, the summary staying as the lead', () => {
    const head = card(['#summary One line lead.', ...SHORT]);
    expect(titles(head)).toEqual(['What changes', 'Before / after', 'Verification']);
    expect(head.querySelector('.pr-summary')?.textContent).toBe('One line lead.');
    expect(head.querySelector('.pr-describe')?.textContent).toContain('The refund button refunds in one click.');
    expect([...head.querySelectorAll('.pr-desc-label')].map((l) => l.textContent)).toEqual(['Before', 'After']);
    expect(head.querySelector('.pr-desc-toggle')).toBeNull();
    const order = [...head.children].map((c) => c.className);
    expect(order.indexOf('pr-summary')).toBeLessThan(order.indexOf('pr-describe'));
  });

  it('shows only the sections the record has, with no empty heading', () => {
    const head = card(['#describe verified Order tests pass.']);
    expect(titles(head)).toEqual(['Verification']);
    for (const heading of head.querySelectorAll('.pr-desc-title')) {
      expect(heading.nextElementSibling?.textContent?.trim()).not.toBe('');
    }
    expect(head.querySelectorAll('.pr-desc-label')).toHaveLength(0);
  });

  it('shows only before when the record has no after', () => {
    const head = card(['#describe before Refunds went through support.']);
    expect(titles(head)).toEqual(['Before / after']);
    expect([...head.querySelectorAll('.pr-desc-label')].map((l) => l.textContent)).toEqual(['Before']);
  });

  it('a record without a description shows only the summary', () => {
    const head = card(['#summary Only a summary.']);
    expect(head.querySelector('.pr-describe')).toBeNull();
    expect(head.querySelector('.pr-desc-title')).toBeNull();
    expect(head.querySelector('.pr-summary')?.textContent).toBe('Only a summary.');
  });

  it('never shows comment markers or the cost block, however they are written', () => {
    const head = card([
      '#describe what <!-- delegate:cost --> Admins can refund orders.',
      '#describe what <!-- delegate:cost -->',
      '#describe what ## Run cost table follows',
      '#describe what | agent | model | effort | context |',
      '#describe what delegate:cost',
      '#describe verified Order tests pass. <!-- hidden',
    ]);
    const text = head.querySelector('.pr-describe')?.textContent ?? '';
    expect(text).not.toMatch(/<!--|-->|delegate:cost|\|/);
    expect(text).toContain('Admins can refund orders.');
    expect(text).toContain('Order tests pass.');
  });

  it('sets text as text: markup in a line stays literal', () => {
    const head = card(['#describe what <img src=x onerror=alert(1)> <b>bold</b>']);
    expect(head.querySelector('.pr-describe img')).toBeNull();
    expect(head.querySelector('.pr-describe b')).toBeNull();
    expect(head.querySelector('.pr-describe')?.textContent).toContain('<b>bold</b>');
  });

  describe('a long description', () => {
    const long = [
      '#describe what First thing changes for the user.',
      '#describe what Second thing changes for the user.',
      '#describe what Third thing changes for the user.',
      '#describe before The old way took many steps.',
      '#describe after The new way takes one step.',
      '#describe verified Tests pass.',
    ];

    it('collapses to a short lead with Show details, then expands and collapses again', () => {
      const head = card(long);
      const host = head.querySelector('.pr-describe') as HTMLElement;
      expect(host.classList.contains('collapsed')).toBe(true);
      expect(titles(head)).toEqual(['What changes']);
      expect(host.textContent).toContain('First thing changes for the user.');
      expect(host.textContent).not.toContain('Second thing');
      const toggle = head.querySelector('.pr-desc-toggle') as HTMLButtonElement;
      expect(toggle.textContent).toBe('Show details');
      toggle.click();
      expect(titles(head)).toEqual(['What changes', 'Before / after', 'Verification']);
      expect(head.querySelector('.pr-describe')?.textContent).toContain('Third thing');
      const hide = head.querySelector('.pr-desc-toggle') as HTMLButtonElement;
      expect(hide.textContent).toBe('Hide details');
      hide.click();
      expect(titles(head)).toEqual(['What changes']);
    });

    it('collapses on length alone as well', () => {
      const head = card([`#describe what ${'word '.repeat(70).trim()}`]);
      expect(head.querySelector('.pr-desc-toggle')?.textContent).toBe('Show details');
    });
  });
});
