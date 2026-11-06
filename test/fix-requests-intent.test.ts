// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY_CHOICES, PER_COMMENT, browserChoiceBackend, choiceKey, intentOf } from '../src/renderer/lib/fixrequests/intent';

afterEach(() => localStorage.clear());

describe('which intent a comment is copied with', () => {
  it('uses its own intent whatever the copy default is', () => {
    expect(intentOf({ intent: 'explain' }, 'question')).toBe('explain');
    expect(intentOf({ intent: 'fix' }, 'question')).toBe('fix');
    expect(intentOf({ intent: 'question' }, PER_COMMENT)).toBe('question');
  });

  it('uses the copy default for a comment without one, and fix when the copy goes per comment', () => {
    expect(intentOf({}, 'question')).toBe('question');
    expect(intentOf({}, 'explain')).toBe('explain');
    expect(intentOf({}, PER_COMMENT)).toBe('fix');
  });

  it('offers per comment first, then each intent', () => {
    expect([...COPY_CHOICES]).toEqual(['per-comment', 'fix', 'explain', 'question']);
  });
});

describe('the copy default kept for a project', () => {
  it('starts as per comment, remembers a choice and keeps one per project', () => {
    expect(browserChoiceBackend('/work/app').load()).toBe(PER_COMMENT);

    browserChoiceBackend('/work/app').save('question');
    browserChoiceBackend('/work/other').save('explain');

    expect(browserChoiceBackend('/work/app').load()).toBe('question');
    expect(browserChoiceBackend('/work/other').load()).toBe('explain');
    expect(browserChoiceBackend(undefined).load()).toBe(PER_COMMENT);
  });

  it('forgets the entry when the choice goes back to per comment', () => {
    const backend = browserChoiceBackend('/work/app');
    backend.save('question');

    backend.save(PER_COMMENT);

    expect(localStorage.getItem(choiceKey('/work/app'))).toBeNull();
  });

  it('falls back to per comment for a saved value it does not know, or when storage is unavailable', () => {
    localStorage.setItem(choiceKey('/work/app'), 'review-later');
    expect(browserChoiceBackend('/work/app').load()).toBe(PER_COMMENT);

    const broken = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(browserChoiceBackend('/work/app').load()).toBe(PER_COMMENT);
    broken.mockRestore();

    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => browserChoiceBackend('/work/app').save('explain')).not.toThrow();
    blocked.mockRestore();
  });
});
