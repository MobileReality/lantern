import { describe, expect, it } from 'vitest';
import { githubInfoOf } from '../src/main/lantern-host-github';
import { hostInfoOf } from '../src/main/lantern-host-request';

describe('pull request info from the host answer', () => {
  it('keeps only well-formed fields', () => {
    expect(hostInfoOf({ author: { nickname: 'pbabula' }, created_on: 'yesterday', updated_on: '2026-10-30T10:00:00Z', comment_count: -1, task_count: 1.5 })).toEqual({
      from: 'host',
      author: { name: 'pbabula' },
      updated: '2026-10-30T10:00:00Z',
      reviewers: [],
    });
    expect(hostInfoOf(null)).toEqual({ from: 'host', reviewers: [] });
    expect(hostInfoOf([1, 2])).toEqual({ from: 'host', reviewers: [] });
  });

  it('keeps reviewers known only by nickname apart and caps the list', () => {
    const reviewers = Array.from({ length: 25 }, (_, i) => ({ nickname: `dev${i}` }));
    const info = hostInfoOf({ reviewers });
    expect(info.reviewers).toHaveLength(20);
    expect(info.reviewers?.slice(0, 2).map((r) => r.name)).toEqual(['dev0', 'dev1']);
  });

  it('drops an avatar that is not https', () => {
    expect(hostInfoOf({ author: { display_name: 'Ada', links: { avatar: { href: 'http://x/a.png' } } } }).author).toEqual({ name: 'Ada' });
  });
});

describe('pull request info from a GitHub answer', () => {
  it('adds issue and review comments, keeps requested reviewers and drops an http avatar', () => {
    const info = githubInfoOf({
      user: { login: 'ada', avatar_url: 'http://x/a.png' },
      created_at: '2026-10-30T10:00:00Z',
      comments: 2,
      review_comments: 3,
      draft: true,
      requested_reviewers: [{ login: 'bob', avatar_url: 'https://x/b.png' }, {}],
    });
    expect(info).toEqual({
      from: 'host',
      author: { name: 'ada' },
      created: '2026-10-30T10:00:00Z',
      comments: 5,
      reviewers: [{ name: 'bob', avatar: 'https://x/b.png', approved: false, changes: false }],
      draft: true,
    });
  });
});
