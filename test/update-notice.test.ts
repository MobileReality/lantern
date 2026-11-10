// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showUpdateNotice } from '../src/renderer/features/update-notice';
import { hasLiveSession } from '../src/renderer/lib/idle-tabs';
import { liveSessionCount } from '../src/shared/session-liveness';
import type { UpdateNotice } from '../src/shared/updates';

const HTML = fs.readFileSync(path.join(__dirname, '../src/renderer/workspace.html'), 'utf8');

beforeEach(() => {
  const doc = new DOMParser().parseFromString(HTML, 'text/html');
  for (const script of doc.querySelectorAll('script')) script.remove();
  document.body.innerHTML = doc.body.innerHTML;
});

const byId = (id: string) => document.getElementById(id)!;

function actions(initial: UpdateNotice | null) {
  let push: (notice: UpdateNotice | null) => void = () => {};
  const act = vi.fn(async () => null);
  return { act, push: (notice: UpdateNotice | null) => push(notice), api: { notice: async () => initial, act, onNotice: (listener: (notice: UpdateNotice | null) => void) => (push = listener) } };
}

describe('the update notice in the window', () => {
  it('stays hidden when there is nothing to say', async () => {
    await showUpdateNotice(actions(null).api);
    expect(byId('update-notice').classList.contains('hidden')).toBe(true);
  });

  it('shows the waiting message with Restart now and Not now', async () => {
    await showUpdateNotice(actions({ kind: 'ready', version: '0.3.0', waiting: true }).api);
    expect(byId('update-notice').classList.contains('hidden')).toBe(false);
    expect(byId('update-notice-title').textContent).toBe('Update ready: restart when your sessions finish');
    expect(byId('update-notice-primary').textContent).toBe('Restart now');
    expect(byId('update-notice-secondary').textContent).toBe('Not now');
  });

  it('sends the action of the button that was pressed', async () => {
    const world = actions({ kind: 'ready', version: '0.3.0', waiting: true });
    await showUpdateNotice(world.api);
    byId('update-notice-primary').click();
    byId('update-notice-secondary').click();
    expect(world.act.mock.calls).toEqual([['restart'], ['later']]);
  });

  it('follows a pushed notice: a release link on one platform, gone when it is cleared', async () => {
    const world = actions(null);
    await showUpdateNotice(world.api);
    world.push({ kind: 'available', version: '0.4.0' });
    expect(byId('update-notice-title').textContent).toBe('Lantern 0.4.0 is available');
    byId('update-notice-primary').click();
    expect(world.act).toHaveBeenCalledWith('view');
    world.push(null);
    expect(byId('update-notice').classList.contains('hidden')).toBe(true);
  });
});

describe('the one definition of a live session', () => {
  it('is shared by the idle tabs and the updater', () => {
    expect(hasLiveSession([{ state: 'idle' }])).toBe(true);
    expect(liveSessionCount([{ state: 'idle' }, { state: 'done' }, { state: 'shell' }])).toBe(2);
  });
});
