import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARD_KINDS, deliverTransitionCard, sampleCard } from '../src/main/session-notification';
import { readBranch } from '../src/main/projectroot';

const session = { id: 'a', sessionId: 's-a', state: 'idle', updatedAt: 10, cwd: '/work/repo/src', project: 'src' };
const notice = { kind: 'waiting' as const, session };

const temps: string[] = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-branch-'));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('deliverTransitionCard', () => {
  it('carries the session id only for an interactive session, the one with a terminal', async () => {
    const show = vi.fn();
    await deliverTransitionCard({ kind: 'finished', session: { ...session, id: 'interactive:/work/repo:1' } }, true, show, () => '/work/repo');
    await deliverTransitionCard({ kind: 'finished', session: { ...session, id: 'job-1' } }, true, show, () => '/work/repo');
    expect(show.mock.calls.map(([card]) => card.sessionId)).toEqual(['s-a', '']);
  });

  it('offers the jump only when a terminal is found, and still shows the card when the lookup fails', async () => {
    const show = vi.fn();
    const interactive = { kind: 'finished' as const, session: { ...session, id: 'interactive:/work/repo:1' } };
    await deliverTransitionCard(interactive, true, show, () => '/work/repo', undefined, async () => true);
    await deliverTransitionCard(interactive, true, show, () => '/work/repo', undefined, async () => false);
    await deliverTransitionCard(interactive, true, show, () => '/work/repo', undefined, () => Promise.reject(new Error('ps')));
    expect(show.mock.calls.map(([card]) => card.sessionId)).toEqual(['s-a', '', '']);
  });

  it('does not deliver a card when notifications are disabled', () => {
    const show = vi.fn();
    deliverTransitionCard(notice, false, show, () => '/work/repo');
    expect(show).not.toHaveBeenCalled();
  });

  it('describes a waiting card from the transcript', () => {
    const show = vi.fn();
    const transcript = vi.fn(() => [{ message: { role: 'assistant', content: [{ type: 'text', text: 'Which option do you prefer?' }] } }]);
    deliverTransitionCard(notice, true, show, () => '/work/repo', transcript);
    expect(transcript).toHaveBeenCalledWith(session);
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'waiting', title: 'Claude is waiting for you', context: 'Which option do you prefer?', repoName: 'repo' }),
    );
  });

  it.each([
    ['finished', 'done', 'Claude is done', 'Finished — waiting for your reply'],
    ['permission', 'permission', 'Claude needs your permission', 'Approve or deny the request in the terminal'],
    ['failed', 'error', 'Claude session failed', 'The session stopped with an error'],
  ] as const)('maps a %s notice to a %s card', (kind, cardKind, title, context) => {
    const show = vi.fn();
    deliverTransitionCard({ kind, session }, true, show, () => '/work/repo');
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ kind: cardKind, title, context }));
  });
});

describe('sampleCard', () => {
  it('builds a distinct test card for every kind with the real titles', () => {
    const cards = CARD_KINDS.map(sampleCard);
    expect(cards.map((card) => card.kind)).toEqual(['done', 'waiting', 'permission', 'error']);
    expect(new Set(cards.map((card) => card.title)).size).toBe(4);
    expect(new Set(cards.map((card) => card.id)).size).toBe(4);
  });
});

describe('readBranch', () => {
  it('reads the branch of a normal checkout', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/feat/cards\n');
    expect(readBranch(root)).toBe('feat/cards');
  });

  it('follows the gitdir pointer of a worktree', () => {
    const root = tempDir();
    const gitDir = path.join(root, 'meta');
    fs.mkdirSync(gitDir);
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/fix/x\n');
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: meta\n');
    expect(readBranch(root)).toBe('fix/x');
  });

  it('shortens a detached head and tolerates a folder without git', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), '0123456789abcdef\n');
    expect(readBranch(root)).toBe('0123456');
    expect(readBranch(tempDir())).toBe('');
  });

  it('returns nothing for a HEAD that points somewhere other than a local branch', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/remotes/origin/main\n');
    expect(readBranch(root)).toBe('');
  });
});
