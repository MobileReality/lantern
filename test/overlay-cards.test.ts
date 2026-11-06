// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { middleTruncate, mountOverlay } from '../src/renderer/lib/overlay-cards';

type Card = Parameters<Window['overlay']['open']>[0];

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    kind: 'done',
    title: `Card ${id}`,
    context: 'context',
    repoName: 'lantern',
    branch: 'feat/x',
    cwd: '/work/lantern',
    sessionId: '',
    prefs: { animations: false, dismissMs: 1000, volume: 0.5, timbre: 'bell' },
    ...overrides,
  };
}

let clock = 0;
let frames: (() => void)[] = [];

function setup(reducedMotion = false) {
  const stage = document.createElement('div');
  document.body.replaceChildren(stage);
  const bridge = { open: vi.fn(), jump: vi.fn(), resize: vi.fn(), setInteractive: vi.fn(), animate: vi.fn() };
  const play = vi.fn();
  const overlay = mountOverlay(stage, bridge, {
    play,
    now: () => clock,
    frame: (cb) => frames.push(cb),
    reducedMotion: () => reducedMotion,
  });
  return { stage, bridge, play, overlay };
}

function flush() {
  const pending = frames;
  frames = [];
  for (const cb of pending) cb();
}

const titles = (stage: HTMLElement) => [...stage.querySelectorAll('.title')].map((node) => node.textContent);
const badge = (stage: HTMLElement) => stage.querySelector<HTMLElement>('.badge')!;

beforeEach(() => {
  clock = 0;
  frames = [];
  vi.useRealTimers();
});

describe('overlay cards', () => {
  it('shows one card at a time and counts the queue in a badge', () => {
    const { stage, overlay, play } = setup();
    overlay.add(card('a'));
    overlay.add(card('b', { kind: 'permission' }));
    overlay.add(card('c'));
    expect(titles(stage)).toEqual(['Card a']);
    expect(badge(stage).textContent).toBe('+2');
    expect(play.mock.calls.map(([kind]) => kind)).toEqual(['done', 'permission', 'done']);

    overlay.dismiss('a');
    expect(titles(stage)).toEqual(['Card b']);
    expect(badge(stage).textContent).toBe('+1');
  });

  it('ignores a card it has already shown', () => {
    const { stage, overlay, play } = setup();
    overlay.add(card('a'));
    overlay.add(card('a'));
    expect(badge(stage).hidden).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('drops a queued card that is dismissed before its turn', () => {
    const { stage, overlay } = setup();
    overlay.add(card('a'));
    overlay.add(card('b'));
    overlay.dismiss('b');
    expect(badge(stage).hidden).toBe(true);
    overlay.dismiss('a');
    expect(stage.children).toHaveLength(0);
  });

  it('dismisses itself when the countdown runs out and pauses while hovered', () => {
    const { stage, overlay, bridge } = setup();
    overlay.add(card('a'));
    flush();
    const node = stage.querySelector<HTMLElement>('.card')!;

    clock = 400;
    node.dispatchEvent(new MouseEvent('mouseenter'));
    expect(bridge.setInteractive).toHaveBeenLastCalledWith(true);
    clock = 5000;
    flush();
    expect(titles(stage)).toEqual(['Card a']);

    node.dispatchEvent(new MouseEvent('mouseleave'));
    clock = 5500;
    flush();
    expect(titles(stage)).toEqual(['Card a']);
    clock = 5601;
    flush();
    expect(stage.children).toHaveLength(0);
    expect(bridge.resize).toHaveBeenLastCalledWith(0);
  });

  it('draws the countdown ring from the time left', () => {
    const { stage, overlay } = setup();
    overlay.add(card('a'));
    flush();
    clock = 500;
    flush();
    const ring = stage.querySelector('.progress')!;
    const length = Number(ring.getAttribute('stroke-dasharray'));
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(length / 2);
  });

  it('opens the project and dismisses on a card click, and only dismisses on the close button', () => {
    const { stage, overlay, bridge } = setup();
    overlay.add(card('a'));
    overlay.add(card('b'));
    stage.querySelector<HTMLButtonElement>('.close')!.click();
    expect(bridge.open).not.toHaveBeenCalled();
    expect(titles(stage)).toEqual(['Card b']);
    stage.querySelector<HTMLElement>('.card')!.click();
    expect(bridge.open).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    expect(stage.children).toHaveLength(0);
  });

  it('offers the jump to the terminal only for a card with a session, and dismisses after it', () => {
    const { stage, overlay, bridge } = setup();
    overlay.add(card('a'));
    expect(stage.querySelector('.jump')).toBeNull();
    overlay.dismiss('a');
    overlay.add(card('b', { sessionId: 's-b' }));
    stage.querySelector<HTMLButtonElement>('.jump')!.click();
    expect(bridge.jump).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    expect(bridge.open).not.toHaveBeenCalled();
    expect(stage.children).toHaveLength(0);
  });

  it('asks the window to animate in and out, and waits for the exit only when animated', () => {
    vi.useFakeTimers();
    const { stage, overlay, bridge } = setup();
    overlay.add(card('a', { prefs: { animations: true, dismissMs: 1000, volume: 0, timbre: 'none' } }));
    expect(bridge.animate).toHaveBeenLastCalledWith('in', false);
    overlay.dismiss('a');
    expect(bridge.animate).toHaveBeenLastCalledWith('out', false);
    expect(stage.children).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(stage.children).toHaveLength(0);
  });

  it('treats reduced motion as animations off', () => {
    const { stage, overlay, bridge } = setup(true);
    overlay.add(card('a', { prefs: { animations: true, dismissMs: 1000, volume: 0, timbre: 'none' } }));
    expect(document.body.classList.contains('still')).toBe(true);
    expect(bridge.animate).toHaveBeenLastCalledWith('in', true);
    overlay.dismiss('a');
    expect(bridge.animate).toHaveBeenLastCalledWith('out', true);
    expect(stage.children).toHaveLength(0);
  });

  it('runs one countdown loop per card when cards are dismissed back to back', () => {
    const { overlay } = setup();
    overlay.add(card('a'));
    overlay.add(card('b'));
    overlay.add(card('c'));
    overlay.dismiss('a');
    overlay.dismiss('b');
    flush();
    expect(frames).toHaveLength(1);
    flush();
    expect(frames).toHaveLength(1);
  });

  it('shows the repo and a middle-truncated branch, with no footer row', () => {
    const { stage, overlay } = setup();
    overlay.add(card('a', { kind: 'error', branch: 'feat/a-very-long-branch-name-that-keeps-going' }));
    expect(stage.querySelector('.repo')!.textContent).toBe('lantern');
    expect(stage.querySelector('.branch')!.textContent).toBe(middleTruncate('feat/a-very-long-branch-name-that-keeps-going', 32));
    expect(stage.querySelector('.state')).toBeNull();
    expect(stage.querySelector('.actions')).toBeNull();
  });
});

describe('open button', () => {
  it('sits in the header and opens the project', () => {
    const { stage, overlay, bridge } = setup();
    overlay.add(card('a'));
    const open = stage.querySelector<HTMLButtonElement>('.head .open')!;
    expect(open.getAttribute('aria-label')).toBe('Open in Lantern');
    open.click();
    expect(bridge.open).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(stage.children).toHaveLength(0);
  });
});

describe('middleTruncate', () => {
  it('keeps short text and cuts long text in the middle', () => {
    expect(middleTruncate('main', 32)).toBe('main');
    const cut = middleTruncate('abcdefghij', 7);
    expect(cut).toBe('abc…hij');
    expect(cut).toHaveLength(7);
  });
});
