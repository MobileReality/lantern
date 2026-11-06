// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createReviewComments } from '../src/renderer/lib/comments/controller';
import type { CommentTarget, ReviewComments } from '../src/renderer/lib/comments/controller';
import { memoryFixBackend } from '../src/renderer/lib/fixrequests/store';
import { fileBody } from './helpers/comment-body';

const TARGET: CommentTarget = { pr: { id: '7', title: 'T', branch: 'b' }, path: 'src/a.ts', order: ['src/a.ts'] };
const comments: ReviewComments[] = [];

afterEach(() => {
  comments.splice(0).forEach((each) => { each.dispose(); });
  document.body.replaceChildren();
});

function mounted() {
  const area = document.createElement('div');
  const fileHost = document.createElement('div');
  document.body.append(fileHost, area);
  const body = fileBody(['a', 'b', 'c']);
  area.append(body);
  const backends = new Map<string, ReturnType<typeof memoryFixBackend>>();
  const backendOf = (pr: string) => backends.get(pr) ?? backends.set(pr, memoryFixBackend()).get(pr)!;
  const backend = backendOf('7');
  const view = createReviewComments({ backend: (_project, pr) => backendOf(pr) },{ area, fileHost, bodies: { file: body }, mode: () => 'file', showMode: () => undefined });
  comments.push(view);
  document.body.append(view.tools);
  return { view, fileHost, backend };
}

const tool = (name: string) => document.querySelector(`[data-cm-tool="${name}"]`) as HTMLButtonElement;

function commentOnFile(fileHost: HTMLElement, text: string) {
  tool('file').click();
  const area = fileHost.querySelector('textarea') as HTMLTextAreaElement;
  area.value = text;
  (fileHost.querySelector('.lt-cm-box') as HTMLFormElement).requestSubmit();
}

describe('the review comments controller', () => {
  it('keeps the saved comments and can still save after the pane was cleared and shown again for the same pull request', () => {
    const { view, fileHost, backend } = mounted();
    view.setTarget(TARGET);
    commentOnFile(fileHost, 'first');

    view.setTarget(null);
    expect(tool('file').disabled).toBe(true);
    view.setTarget(TARGET);

    expect(document.querySelector('.lt-cm-count')?.textContent).toBe('1');
    expect(fileHost.querySelector('.lt-cm-card-text')?.textContent).toBe('first');
    commentOnFile(fileHost, 'second');
    expect(backend.saved.map((item) => item.comment)).toEqual(['first', 'second']);
  });

  it('shows another pull request with its own comments', () => {
    const { view, fileHost } = mounted();
    view.setTarget(TARGET);
    commentOnFile(fileHost, 'for seven');

    view.setTarget({ ...TARGET, pr: { ...TARGET.pr, id: '8' } });

    expect(document.querySelector('.lt-cm-count')?.textContent).toBe('0');
    view.setTarget(TARGET);
    expect(document.querySelector('.lt-cm-count')?.textContent).toBe('1');
  });
});
