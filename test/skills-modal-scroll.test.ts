// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExtensionsPanel } from '../src/main/extensions';

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const NAMES = Array.from({ length: 30 }, (_, i) => `skill-${String(i).padStart(2, '0')}`);

const LISTING = {
  installed: true,
  version: '1.0.0',
  project: { name: 'demo', path: '/demo' },
  available: NAMES.map((name) => ({ name, role: 'core' })),
  linked: [] as string[],
  bundled: [],
  local: [],
  broken: [],
  recommended: [],
  remote: 'git@example.com:skills.git',
  repo: '/skills',
};

const PANEL: ExtensionsPanel = {
  slots: { delegate: ['skill-01', 'skill-02'], orchestrator: [], reviewer: [] },
  projectSlots: { delegate: ['skill-03'], orchestrator: [], reviewer: [] },
  projectRoot: '/demo',
  projectError: null,
  alwaysOn: { delegate: ['lantern-commit'], orchestrator: [], reviewer: [] },
  switchable: { delegate: ['lantern-commit'], orchestrator: [], reviewer: [] },
  off: { delegate: [], orchestrator: [], reviewer: [] },
  locked: ['lantern-commit'],
  installed: NAMES,
  skillLinker: null,
  skillLinkerState: 'unset',
  skillLinkerProblem: null,
  skillLinkerPath: null,
  skillLinkerFromRepo: false,
  skillLinkerSkills: 0,
  skillLinkerRoles: 0,
  error: null,
};

let openSkills: () => Promise<void>;

const body = () => document.getElementById('sk-body')!;
const tab = (name: string) => body().querySelector<HTMLButtonElement>(`[data-sk-tab="${name}"]`)!;
const attachedList = () => body().querySelector<HTMLElement>('[data-col="attached"] .sk-list')!;
const candidateList = () => body().querySelector<HTMLElement>('[data-col="candidates"] .sk-list')!;

// jsdom has no layout, so an emptied scroll container would keep its scrollTop; a browser drops it to 0 while the content is gone.
function resetWhenContentIsReplaced(container: HTMLElement) {
  let top = 0;
  Object.defineProperty(container, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => (top = value) });
  const html = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;
  Object.defineProperty(container, 'innerHTML', {
    configurable: true,
    get: () => html.get!.call(container),
    set: (value: string) => {
      top = 0;
      html.set!.call(container, value);
    },
  });
  const replaceChildren = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (this: Element, ...nodes: (Node | string)[]) {
    if (this.classList.contains('sk-extras') && container.contains(this)) top = 0;
    return replaceChildren.apply(this, nodes);
  };
}

beforeAll(async () => {
  document.body.innerHTML = `
    <div id="skills-modal" class="hidden">
      <div class="modal-head"><span id="sk-proj"></span><button id="sk-close"></button></div>
      <div id="sk-body" class="modal-body"></div><div id="sk-foot"></div>
    </div>
    <button id="mic-btn"><span class="mic-fix-label">Mic</span></button>`;
  resetWhenContentIsReplaced(body());
  window.ccmws = {
    skillsList: vi.fn(async () => LISTING),
    skillsLink: vi.fn(async () => ({ ...LISTING, linked: ['skill-00'] })),
    skillsUnlink: vi.fn(async () => LISTING),
    extensionsLoad: vi.fn(async () => PANEL),
    extensionsSave: vi.fn(async () => PANEL),
    extensionsMove: vi.fn(async () => PANEL),
  } as unknown as typeof window.ccmws;
  ({ openSkills } = await import('../src/renderer/features/skills'));
});

afterEach(() => {
  document.getElementById('sk-close')!.click();
});

async function openOn(name: string) {
  void openSkills();
  await settled();
  await settled();
  tab(name).click();
  await settled();
  await settled();
}

function scrollTo(page: number, attached: number, candidates: number) {
  body().scrollTop = page;
  attachedList().scrollTop = attached;
  candidateList().scrollTop = candidates;
}

function expectScroll(page: number, attached: number, candidates: number) {
  expect(body().scrollTop).toBe(page);
  expect(attachedList().scrollTop).toBe(attached);
  expect(candidateList().scrollTop).toBe(candidates);
}

describe('Skills modal keeps its scroll position across an action', () => {
  it('Project skills: linking a skill leaves the list where it was', async () => {
    await openOn('project');
    body().scrollTop = 240;
    body().querySelector<HTMLElement>('.sk-row:not(.locked)')!.click();
    await settled();
    await settled();
    expect(window.ccmws.skillsLink).toHaveBeenCalled();
    expect(body().scrollTop).toBe(240);
  });

  it('Lantern skills: attaching a skill keeps the page and both lists where they were', async () => {
    await openOn('lantern');
    scrollTo(120, 15, 90);
    body().querySelector<HTMLElement>('[data-pick="skill-20"]')!.click();
    await settled();
    await settled();
    expect(window.ccmws.extensionsSave).toHaveBeenCalled();
    expectScroll(120, 15, 90);
  });

  it('Lantern skills: detaching a skill keeps the page and both lists where they were', async () => {
    await openOn('lantern');
    scrollTo(75, 10, 30);
    body().querySelector<HTMLElement>('[data-detach="skill-01"]')!.click();
    await settled();
    await settled();
    expectScroll(75, 10, 30);
  });

  it('Lantern skills: moving a skill to the other scope keeps the page and both lists where they were', async () => {
    await openOn('lantern');
    scrollTo(60, 20, 45);
    body().querySelector<HTMLElement>('[data-extra="skill-01"] [data-scope]')!.click();
    await settled();
    await settled();
    expect(window.ccmws.extensionsMove).toHaveBeenCalled();
    expectScroll(60, 20, 45);
  });

  it('Lantern skills: choosing the scope to attach as keeps the page and both lists where they were', async () => {
    await openOn('lantern');
    scrollTo(50, 5, 70);
    body().querySelector<HTMLElement>('.sk-scope-pick [data-segment="global"]')!.click();
    await settled();
    expectScroll(50, 5, 70);
  });

  it('Lantern skills: switching a built-in skill off keeps the page and both lists where they were', async () => {
    await openOn('lantern');
    scrollTo(80, 8, 35);
    body().querySelector<HTMLElement>('[data-switch="lantern-commit"]')!.click();
    await settled();
    await settled();
    expectScroll(80, 8, 35);
  });

  it('Lantern skills: searching leaves the page where it was', async () => {
    await openOn('lantern');
    body().scrollTop = 110;
    const search = body().querySelector<HTMLInputElement>('[data-pick-search]')!;
    search.value = 'skill-2';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(body().scrollTop).toBe(110);
    expect(body().querySelector('[data-pick="skill-20"]')).not.toBeNull();
    expect(body().querySelector('[data-pick="skill-05"]')).toBeNull();
  });

  it('Lantern skills: switching the role keeps the page and starts the lists from the top', async () => {
    await openOn('lantern');
    scrollTo(90, 25, 65);
    body().querySelector<HTMLElement>('[data-segment="reviewer"]')!.click();
    await settled();
    expect(body().querySelector('[data-board]')!.getAttribute('data-board')).toBe('reviewer');
    expectScroll(90, 0, 0);
  });

  it('Lantern skills: a refresh of the tab keeps the page where it was', async () => {
    await openOn('lantern');
    body().scrollTop = 130;
    Array.from(document.querySelectorAll<HTMLElement>('#sk-foot button'))[0].click();
    await settled();
    await settled();
    await settled();
    expect(body().scrollTop).toBe(130);
  });
});
