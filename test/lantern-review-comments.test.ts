// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrFileDiff } from '../src/main/lantern-prdiff';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { storageKey } from '../src/renderer/lib/fixrequests/store';
import { mapOf, node, pr } from './helpers/lantern-map';

const PROJECT = '/work/app';
const NODES = [node('src/svc.ts', 'service'), node('src/repo.ts', 'repository')];
const OPEN = pr('7', {
  title: 'Add repo caching',
  branch: 'feat/repo-cache',
  files: [
    { path: 'src/svc.ts', kind: 'modified', mapped: true },
    { path: 'src/repo.ts', kind: 'modified', mapped: true },
  ],
});
const FILE_TEXT = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].join('\n');
const DIFF_TEXT = '@@ -1,3 +1,4 @@\n alpha\n-beta\n+beta two\n+beta three\n gamma';

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const mounted: ReturnType<typeof mountLanternView>[] = [];
const copied: string[] = [];

beforeEach(() => {
  copied.length = 0;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async (text: string) => void copied.push(text)) } });
});

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
  localStorage.clear();
});

async function open(path = 'src/svc.ts', mode: 'file' | 'diff' = 'file', language?: string) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const readPrFile = async () => ({ ok: true as const, text: FILE_TEXT, truncated: false, binary: false, version: 'branch' as const });
  const readPrDiff = async (): Promise<PrFileDiff> => ({ ok: true, diff: DIFF_TEXT, truncated: false, binary: false });
  const map = mapOf({ nodes: NODES, prs: [OPEN] });
  mounted.push(mountLanternView(root, language ? { ...map, language: { ...map.language, code: language } } : map, { project: PROJECT, readFile: async () => ({ exists: true, text: FILE_TEXT, truncated: 0 }), readPrFile, readPrDiff }));
  (root.querySelector('.pr-chip[data-pr="7"]') as HTMLElement).click();
  (root.querySelector(`[data-pr-go="${path}"]`) as HTMLElement).click();
  if (mode === 'diff') (root.querySelector('.lt-review-mode[data-review-mode="diff"]') as HTMLElement).click();
  await flush();
  return root;
}

const tool = (root: HTMLElement, name: string) => root.querySelector(`.lt-cm-tools [data-cm-tool="${name}"]`) as HTMLButtonElement;
const body = (root: HTMLElement) => root.querySelector('.lt-review-body > .rv-code:not([hidden])') as HTMLElement;
const box = (root: HTMLElement) => root.querySelector('.lt-cm-box:not([hidden])') as HTMLFormElement | null;
const text = (root: HTMLElement) => (box(root) as HTMLFormElement).querySelector('textarea') as HTMLTextAreaElement;
const stored = () => JSON.parse(localStorage.getItem(storageKey(PROJECT, '7')) ?? '[]');
const lineOf = (row: Element) => row.querySelectorAll('.ln')[1]?.textContent;
const shape = (root: HTMLElement) =>
  [...body(root).children].map((child) => (child.classList.contains('cl') ? `line ${lineOf(child) || '-'}` : child.classList.contains('lt-cm-card') ? `card ${child.querySelector('.lt-cm-card-text')?.textContent}` : child.classList.contains('lt-cm-box') ? 'box' : child.classList.contains('lt-cm-note') ? 'note' : child.className));
const cards = (root: HTMLElement) => [...root.querySelectorAll('.lt-cm-card')].map((card) => `${card.querySelector('.lt-cm-where')?.textContent}: ${card.querySelector('.lt-cm-card-text')?.textContent}`);

function type(input: HTMLTextAreaElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function pick(root: HTMLElement, from: number, to: number) {
  const codes = [...body(root).querySelectorAll('.cl.ctx .code, .cl.add .code')] as HTMLElement[];
  document.getSelection()?.setBaseAndExtent(codes[from - 1], 0, codes[to - 1], codes[to - 1].childNodes.length);
  (root.querySelector('.lt-review-body') as HTMLElement).dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

function save(root: HTMLElement, comment: string) {
  type(text(root), comment);
  text(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
}

async function commentLines(root: HTMLElement, from: number, to: number, comment: string) {
  pick(root, from, to);
  (root.querySelector('.lt-cm-float') as HTMLElement).click();
  save(root, comment);
  await flush();
}

describe('inline comments in the review pane', () => {
  it('has no bottom panel: the header carries Comment, Comments with its count and Copy all', async () => {
    const root = await open();

    expect(root.querySelector('.lt-fixes')).toBeNull();
    expect(tool(root, 'file').textContent).toBe('Comment');
    expect(tool(root, 'list').querySelector('.lt-cm-count')?.textContent).toBe('0');
    expect(tool(root, 'copy').disabled).toBe(true);
    expect(root.querySelector('.lt-review-head')?.contains(tool(root, 'file'))).toBe(true);
  });

  it('shows no comment tools until a file is open', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(mountLanternView(root, mapOf({ nodes: NODES, prs: [OPEN] }), { project: PROJECT }));
    (root.querySelector('.pr-chip[data-pr="7"]') as HTMLElement).click();

    expect((root.querySelector('.lt-review-head') as HTMLElement).hidden).toBe(true);
  });

  it('comments on a selection: a Comment button appears, the box opens under the last selected line with the lines highlighted', async () => {
    const root = await open();

    pick(root, 2, 3);
    const float = root.querySelector('.lt-cm-float') as HTMLButtonElement;
    expect(float.hidden).toBe(false);
    float.click();

    expect(shape(root)).toEqual(['line 1', 'line 2', 'line 3', 'box', 'line 4', 'line 5']);
    expect(document.activeElement).toBe(text(root));
    expect([...body(root).querySelectorAll('.cl.lt-cm-live')].map(lineOf)).toEqual(['2', '3']);
    expect(box(root)?.querySelector('.lt-cm-box-title')?.textContent).toBe('Comment on lines 2–3');
    expect(float.hidden).toBe(true);
  });

  it('saves with Ctrl+Enter, leaves a card under the line with its text and marks the range', async () => {
    const root = await open();

    await commentLines(root, 2, 3, 'Why two passes?');

    expect(shape(root)).toEqual(['line 1', 'line 2', 'line 3', 'card Why two passes?', 'line 4', 'line 5']);
    expect(box(root)).toBeNull();
    expect([...body(root).querySelectorAll('.cl.lt-cm-mark')].map(lineOf)).toEqual(['2', '3']);
    expect(stored()[0]).toMatchObject({ path: 'src/svc.ts', start: 2, end: 3, code: 'beta\ngamma', comment: 'Why two passes?' });
    expect(tool(root, 'list').querySelector('.lt-cm-count')?.textContent).toBe('1');
  });

  it('cancels with Escape, keeps nothing and puts the focus back in the code', async () => {
    const root = await open();
    pick(root, 2, 2);
    (root.querySelector('.lt-cm-float') as HTMLElement).click();
    type(text(root), 'never mind');

    text(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(box(root)).toBeNull();
    expect(stored()).toEqual([]);
    expect(document.activeElement?.classList.contains('lt-cm-add')).toBe(true);
    expect(body(root).contains(document.activeElement)).toBe(true);
  });

  it('puts the focus back in the code after saving', async () => {
    const root = await open();

    await commentLines(root, 3, 3, 'Rename.');

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Comment on line 3');
  });

  it('comments on a line through the gutter plus without selecting', async () => {
    const root = await open();
    const row = [...body(root).querySelectorAll('.cl')][3];
    row.querySelector('.code')?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    const add = body(root).querySelector('.lt-cm-add') as HTMLButtonElement;

    expect(add.getAttribute('aria-label')).toBe('Comment on line 4');
    add.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    add.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));

    expect(shape(root)).toEqual(['line 1', 'line 2', 'line 3', 'line 4', 'box', 'line 5']);
  });

  it('drags over the gutter plus signs to take a range', async () => {
    const root = await open();
    const rows = [...body(root).querySelectorAll('.cl')];
    rows[1].querySelector('.code')?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    const add = body(root).querySelector('.lt-cm-add') as HTMLButtonElement;

    add.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    rows[3].dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    expect([...body(root).querySelectorAll('.cl.lt-cm-live')].map(lineOf)).toEqual(['2', '3', '4']);
    rows[3].dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));

    expect(shape(root)).toEqual(['line 1', 'line 2', 'line 3', 'line 4', 'box', 'line 5']);
    expect(box(root)?.querySelector('.lt-cm-box-title')?.textContent).toBe('Comment on lines 2–4');
  });

  it('comments on the whole file under the header, with chips instead of a dropdown', async () => {
    const root = await open();

    tool(root, 'file').click();

    expect(root.querySelector('.lt-cm-file')?.contains(box(root))).toBe(true);
    expect(box(root)?.querySelector('select')).toBeNull();
    (box(root)?.querySelector('.lt-cm-chip[data-preset="simplify"]') as HTMLElement).click();
    expect(text(root).value).toBe('Simplify this.');
    type(text(root), 'Simplify this, it loops twice.');
    text(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    await flush();

    expect(cards(root)).toEqual(['File: Simplify this, it loops twice.']);
    expect(root.querySelector('.lt-cm-file')?.contains(root.querySelector('.lt-cm-card'))).toBe(true);
    expect(stored()[0]).toMatchObject({ path: 'src/svc.ts', preset: 'simplify', comment: 'Simplify this, it loops twice.' });
    expect(stored()[0]).not.toHaveProperty('start');
    expect(document.activeElement).toBe(tool(root, 'file'));
  });

  it('offers the texts in the language of the map', async () => {
    const root = await open('src/svc.ts', 'file', 'pl');

    tool(root, 'file').click();

    expect(box(root)?.querySelector('.lt-cm-chip[data-preset="remove"]')?.textContent).toBe('Usuń to.');
  });

  it('shows the cards again after switching to the diff and back', async () => {
    const root = await open();
    await commentLines(root, 2, 3, 'Why two passes?');

    (root.querySelector('.lt-review-mode[data-review-mode="diff"]') as HTMLElement).click();
    await flush();
    expect(shape(root)).toEqual(['line 1', 'line -', 'line 2', 'line 3', 'card Why two passes?', 'line 4']);

    (root.querySelector('.lt-review-mode[data-review-mode="file"]') as HTMLElement).click();
    await flush();
    expect(shape(root)).toEqual(['line 1', 'line 2', 'line 3', 'card Why two passes?', 'line 4', 'line 5']);
  });

  it('comments on a diff selection by new-file lines, past the removed line', async () => {
    const root = await open('src/svc.ts', 'diff');

    await commentLines(root, 2, 3, 'In the diff.');

    expect(stored()[0]).toMatchObject({ start: 2, end: 3, code: 'beta two\nbeta three' });
    expect(shape(root)).toEqual(['line 1', 'line -', 'line 2', 'line 3', 'card In the diff.', 'line 4']);
  });

  it('says how many comments are not in this view and jumps to the view that shows them', async () => {
    const root = await open();
    await commentLines(root, 5, 5, 'Only in the file.');

    (root.querySelector('.lt-review-mode[data-review-mode="diff"]') as HTMLElement).click();
    await flush();
    const note = body(root).querySelector('.lt-cm-note') as HTMLElement;
    expect(note.querySelector('.lt-cm-note-text')?.textContent).toBe('1 comment not shown in this view');
    (note.querySelector('.lt-cm-note-show') as HTMLElement).click();
    await flush();

    expect(root.querySelector('.lt-review-mode[data-review-mode="file"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(cards(root)).toEqual(['Line 5: Only in the file.']);
  });

  it('keeps the cards over a restart', async () => {
    const first = await open();
    await commentLines(first, 2, 2, 'remember me');
    tool(first, 'file').click();
    save(first, 'and the file');
    mounted.splice(0).forEach((one) => { one.dispose(); });
    first.remove();

    const second = await open();

    expect(cards(second)).toEqual(['File: and the file', 'Line 2: remember me']);
    expect(shape(second)).toEqual(['line 1', 'line 2', 'card remember me', 'line 3', 'line 4', 'line 5']);
  });

  it('edits a card in place, keeping its lines, and puts the focus back on the card', async () => {
    const root = await open();
    await commentLines(root, 2, 3, 'first thought');

    (root.querySelector('.lt-cm-card-edit') as HTMLElement).click();
    expect(shape(root)).toEqual(['line 1', 'line 2', 'line 3', 'box', 'line 4', 'line 5']);
    expect(text(root).value).toBe('first thought');
    save(root, 'second thought');
    await flush();

    expect(shape(root)).toEqual(['line 1', 'line 2', 'line 3', 'card second thought', 'line 4', 'line 5']);
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ start: 2, end: 3, code: 'beta\ngamma', comment: 'second thought' });
    expect(document.activeElement).toBe(root.querySelector('.lt-cm-card-edit'));
  });

  it('deletes a card and the count follows', async () => {
    const root = await open();
    await commentLines(root, 2, 2, 'gone soon');

    (root.querySelector('.lt-cm-card-delete') as HTMLElement).click();
    await flush();

    expect(cards(root)).toEqual([]);
    expect(tool(root, 'list').querySelector('.lt-cm-count')?.textContent).toBe('0');
    expect(localStorage.getItem(storageKey(PROJECT, '7'))).toBeNull();
    expect(tool(root, 'copy').disabled).toBe(true);
  });

  it('collapses a card to one line and opens it again', async () => {
    const root = await open();
    await commentLines(root, 2, 2, 'a long thought');
    const card = root.querySelector('.lt-cm-card') as HTMLElement;

    (card.querySelector('.lt-cm-fold') as HTMLElement).click();
    expect(card.classList.contains('lt-cm-collapsed')).toBe(true);
    (card.querySelector('.lt-cm-fold') as HTMLElement).click();

    expect(card.classList.contains('lt-cm-collapsed')).toBe(false);
  });

  it('lists every comment of the pull request by file and opens the file and card of the one clicked', async () => {
    const root = await open('src/repo.ts');
    tool(root, 'file').click();
    save(root, 'repo note');
    await flush();
    (root.querySelector('[data-pr-go="src/svc.ts"]') as HTMLElement).click();
    await flush();
    await commentLines(root, 4, 4, 'svc line note');

    tool(root, 'list').click();
    const paths = [...root.querySelectorAll('.lt-cm-pop-path')].map((each) => each.textContent);
    expect(paths).toEqual(['src/svc.ts', 'src/repo.ts']);
    (root.querySelector('.lt-cm-pop-group:last-child .lt-cm-pop-item') as HTMLElement).click();
    await flush();

    expect(root.querySelector('.lt-review .lt-code-path')?.getAttribute('data-tip')).toBe('src/repo.ts');
    expect(root.querySelector('.lt-cm-card.lt-cm-flash .lt-cm-card-text')?.textContent).toBe('repo note');
    expect((root.querySelector('.lt-cm-pop') as HTMLElement).hidden).toBe(true);
  });

  it('copies every comment as one text, header and pull request scope first, each comment with its instruction', async () => {
    const root = await open();
    await commentLines(root, 2, 3, 'Why two passes?');
    tool(root, 'file').click();
    save(root, 'Rename the module.');
    await flush();

    tool(root, 'copy').click();
    await flush();

    const fix = 'Intent: Fix. Change the code to address this comment.';
    expect(copied).toEqual([
      `Review comments for PR #7: Add repo caching (feat/repo-cache)\nWork within this pull request only: stay on its branch and inside the code it changes.\n\nsrc/svc.ts\nComment: Rename the module.\n${fix}\n\nsrc/svc.ts:2-3\n\`\`\`\nbeta\ngamma\n\`\`\`\nComment: Why two passes?\n${fix}`,
    ]);
    expect(tool(root, 'copy').textContent).toBe('Copied');
  });
});

describe('inline comments by keyboard', () => {
  it('does not step to another file when the arrows move the caret in the comment', async () => {
    const root = await open();
    tool(root, 'file').click();
    text(root).focus();

    text(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await flush();

    expect(root.querySelector('.lt-review .lt-code-path')?.getAttribute('data-tip')).toBe('src/svc.ts');
  });

  it('does not step to another file from a chip or the comment list either', async () => {
    const root = await open();
    tool(root, 'file').click();
    const chip = box(root)?.querySelector('.lt-cm-chip') as HTMLElement;

    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await flush();

    expect(root.querySelector('.lt-review .lt-code-path')?.getAttribute('data-tip')).toBe('src/svc.ts');
  });

  it('reaches the gutter plus with Tab-order focus and comments on a range from the keyboard', async () => {
    const root = await open();
    const add = body(root).querySelector('.lt-cm-add') as HTMLButtonElement;
    add.focus();

    add.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }));
    add.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }));
    add.click();

    expect(box(root)?.querySelector('.lt-cm-box-title')?.textContent).toBe('Comment on lines 1–3');
    expect(document.activeElement).toBe(text(root));
  });

  it('labels the controls so the cards can be told apart', async () => {
    const root = await open();
    await commentLines(root, 2, 3, 'note');

    const card = root.querySelector('.lt-cm-card') as HTMLElement;

    expect(card.querySelector('.lt-cm-card-edit')?.getAttribute('aria-label')).toBe('Edit the comment on lines 2–3');
    expect(card.querySelector('.lt-cm-card-delete')?.getAttribute('aria-label')).toBe('Delete the comment on lines 2–3');
    expect(tool(root, 'list').getAttribute('aria-label')).toBe('Comments, 1 comment');
    expect(root.querySelector('.lt-cm-tools [role="status"]')?.textContent).toBe('Comment added');
  });
});

describe('the intent of a comment', () => {
  const radios = (root: HTMLElement) => [...(box(root) as HTMLFormElement).querySelectorAll<HTMLInputElement>('.lt-cm-intent input[type="radio"]')];
  const checked = (root: HTMLElement) => radios(root).find((each) => each.checked)?.value;
  const chip = (root: HTMLElement, id: string) => (box(root) as HTMLFormElement).querySelector(`.lt-cm-chip[data-preset="${id}"]`) as HTMLButtonElement;
  const choice = (root: HTMLElement) => root.querySelector('.lt-cm-tools .lt-cm-choice') as HTMLSelectElement;
  const tags = (root: HTMLElement) => [...root.querySelectorAll('.lt-cm-card .lt-cm-tag')].map((each) => each.textContent);

  function chooseCopy(root: HTMLElement, value: string) {
    choice(root).value = value;
    choice(root).dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('offers a labelled Fix, Explain and Question choice in the box, Fix selected, each one reachable by keyboard', async () => {
    const root = await open();

    tool(root, 'file').click();

    const group = (box(root) as HTMLFormElement).querySelector('.lt-cm-intent') as HTMLElement;
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-label')).toBe('Intent');
    expect(radios(root).map((each) => each.closest('label')?.textContent)).toEqual(['Fix', 'Explain', 'Question']);
    expect(radios(root).map((each) => each.value)).toEqual(['fix', 'explain', 'question']);
    expect(radios(root).every((each) => each.tabIndex === 0 && !each.disabled && each.name === radios(root)[0].name)).toBe(true);
    expect(checked(root)).toBe('fix');
  });

  it('saves a comment nobody changed the intent of without an intent, and shows no label on its card', async () => {
    const root = await open();

    await commentLines(root, 2, 2, 'plain note');

    expect(stored()[0]).not.toHaveProperty('intent');
    expect(tags(root)).toEqual([]);
  });

  it('saves the intent chosen, and shows it as a quiet label on the card', async () => {
    const root = await open();
    tool(root, 'file').click();
    radios(root)[2].click();
    save(root, 'What is this platform selected flow for?');
    await flush();

    expect(stored()[0].intent).toBe('question');
    expect(tags(root)).toEqual(['Question']);
    expect(root.querySelector('.lt-cm-file .lt-cm-card .lt-cm-tag')?.textContent).toBe('Question');
  });

  it('keeps Fix as a choice of its own when it is clicked while already selected', async () => {
    const root = await open();
    tool(root, 'file').click();

    radios(root)[0].click();
    save(root, 'definitely a fix');
    await flush();

    expect(stored()[0].intent).toBe('fix');
    expect(tags(root)).toEqual(['Fix']);
  });

  it('lets the text that asks for an explanation suggest the Explain intent', async () => {
    const root = await open();
    tool(root, 'file').click();

    chip(root, 'explain').click();

    expect(checked(root)).toBe('explain');
    save(root, 'Explain why this is needed.');
    await flush();
    expect(stored()[0].intent).toBe('explain');
  });

  it('does not let a text override an intent the user chose, and a text that suggests nothing leaves it alone', async () => {
    const root = await open();
    tool(root, 'file').click();
    radios(root)[2].click();

    chip(root, 'explain').click();
    chip(root, 'rename').click();

    expect(checked(root)).toBe('question');
  });

  it('lets a later text change a suggestion but not a choice made after it', async () => {
    const root = await open();
    tool(root, 'file').click();
    chip(root, 'explain').click();
    radios(root)[0].click();

    chip(root, 'explain').click();

    expect(checked(root)).toBe('fix');
  });

  it('opens an edit with the saved intent selected and keeps a comment without one unset', async () => {
    const root = await open();
    await commentLines(root, 2, 2, 'plain note');
    tool(root, 'file').click();
    radios(root)[1].click();
    save(root, 'explain me');
    await flush();

    (root.querySelector('.lt-cm-file .lt-cm-card-edit') as HTMLElement).click();
    expect(checked(root)).toBe('explain');
    radios(root)[2].click();
    save(root, 'explain me, as a question');
    await flush();
    expect(tags(root)).toEqual(['Question']);

    (root.querySelector('.lt-review-body .lt-cm-card-edit') as HTMLElement).click();
    expect(checked(root)).toBe('fix');
    save(root, 'plain note, reworded');
    await flush();
    expect(stored().find((item: { comment: string }) => item.comment === 'plain note, reworded')).not.toHaveProperty('intent');
  });

  it('offers a default for Copy all next to it, per comment at first, and remembers a choice per project', async () => {
    const root = await open();

    expect(root.querySelector('.lt-cm-tools')?.contains(choice(root))).toBe(true);
    expect(choice(root).getAttribute('aria-label')).toBe('Copy all, default intent');
    expect([...choice(root).options].map((each) => [each.value, each.textContent])).toEqual([
      ['per-comment', 'Per comment'],
      ['fix', 'Default: Fix'],
      ['explain', 'Default: Explain'],
      ['question', 'Default: Question'],
    ]);
    expect(choice(root).value).toBe('per-comment');

    chooseCopy(root, 'question');
    mounted.splice(0).forEach((one) => { one.dispose(); });
    root.remove();
    const again = await open();

    expect(choice(again).value).toBe('question');
  });

  it('copies comments without an intent of their own as the chosen default and keeps the ones that have one', async () => {
    const root = await open();
    await commentLines(root, 2, 3, 'Why two passes?');
    tool(root, 'file').click();
    radios(root)[1].click();
    save(root, 'Walk me through this file.');
    await flush();
    chooseCopy(root, 'question');

    tool(root, 'copy').click();
    await flush();

    const text = copied[0];
    expect(text).toContain('src/svc.ts\nComment: Walk me through this file.\nIntent: Explain. Explain this without changing any code.');
    expect(text).toContain('Comment: Why two passes?\nIntent: Question. Answer this question without changing any code.');
    expect(text).toContain('These comments differ. Follow the instruction on each one:\n- Explain: ');
    expect(text).not.toContain('- Fix: ');
    expect(text).toContain('Work within this pull request only');
  });

  it('shows the default the copy will follow in the box, so an unset comment never looks like another intent than it is copied with', async () => {
    const root = await open();
    chooseCopy(root, 'question');

    tool(root, 'file').click();
    expect(checked(root)).toBe('question');
    save(root, 'follows the default');
    await flush();
    expect(stored()[0]).not.toHaveProperty('intent');

    (root.querySelector('.lt-cm-file .lt-cm-card-edit') as HTMLElement).click();
    expect(checked(root)).toBe('question');
    tool(root, 'copy').click();
    await flush();
    expect(copied[0]).toContain('Comment: follows the default\nIntent: Question.');
  });

  it('copies only questions without ever saying fix', async () => {
    const root = await open();
    await commentLines(root, 2, 2, 'What is this for?');
    chooseCopy(root, 'question');

    tool(root, 'copy').click();
    await flush();

    expect(copied[0]).toContain('Intent: Question.');
    expect(copied[0]).not.toMatch(/\bfix\b/i);
  });

  it('copies a comment saved before intents existed as a fix', async () => {
    localStorage.setItem(storageKey(PROJECT, '7'), JSON.stringify([{ id: 'old', path: 'src/svc.ts', start: 2, end: 2, code: 'beta', preset: 'fix', comment: 'Fix this.' }]));
    const root = await open();

    tool(root, 'copy').click();
    await flush();

    expect(copied[0]).toContain('Comment: Fix this.\nIntent: Fix. Change the code to address this comment.');
    expect(tags(root)).toEqual([]);
  });

  it('writes the copy in the language of the map', async () => {
    const root = await open('src/svc.ts', 'file', 'pl');
    await commentLines(root, 2, 2, 'Po co to?');

    tool(root, 'copy').click();
    await flush();

    expect(copied[0].split('\n')[0]).toBe('Komentarze z review dla PR #7: Add repo caching (feat/repo-cache)');
    expect(copied[0]).toContain('Zamiar: Popraw. Zmień kod, aby uwzględnić ten komentarz.');
  });
});
