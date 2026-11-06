// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MacroViewContext, MountedMacroView } from '../src/renderer/lib/macroview/types';
import { mountMacroView } from '../src/renderer/lib/macroview/mount';
import { foundationFocus } from '../src/renderer/lib/lanternmacrofoundation';
import { usesAreasPayload } from './helpers/macro-uses-world';

const payload = usesAreasPayload();
const CSS = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'lantern-macroview.css'), 'utf8');

let host: HTMLElement;
let mounted: MountedMacroView | null = null;

function context(extra: Partial<MacroViewContext> = {}): MacroViewContext {
  return {
    payload,
    scene: { level: 'areas', files: 0, tests: 0, relations: 0, blocks: [], edges: [], systems: [] },
    prMarks: null,
    reading: { file: null, blocks: new Set() },
    flowStep: null,
    selection: null,
    foundation: null,
    openFile: () => undefined,
    select: () => undefined,
    enter: () => true,
    leave: () => true,
    ...extra,
  };
}

function select(key: string) {
  mounted = mountMacroView(host, context());
  mounted.update(context({ selection: key, foundation: foundationFocus(context().scene, payload.areas, key) }));
}

const item = (key: string) => host.querySelector(`[data-key="${key}"]`) as SVGGElement;
const flagged = (flag: string) => [...host.querySelectorAll(`.${flag}`)].map((node) => node.getAttribute('data-key')).sort();
const rule = (selector: string) => CSS.split('\n').find((line) => line.startsWith(selector)) ?? '';
const opacityOf = (line: string) => Number(/opacity: ([0-9.]+)/.exec(line)?.[1] ?? 1);
const widthOf = (line: string) => Number(/stroke-width: ([0-9.]+)px/.exec(line)?.[1] ?? 0);

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  const sized = (property: 'clientWidth' | 'clientHeight', value: number) =>
    vi.spyOn(HTMLElement.prototype, property, 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('lt-macroview') ? value : 0;
    });
  sized('clientWidth', 700);
  sized('clientHeight', 880);
  Object.assign(HTMLElement.prototype, { setPointerCapture: () => undefined, releasePointerCapture: () => undefined, hasPointerCapture: () => true });
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
});

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  host.remove();
  vi.restoreAllMocks();
});

describe('a selected platform whose files reach features it has no files in', () => {
  it('lights the places with its files as related and the places it only reaches as uses', () => {
    select('block:core:bot-b');

    expect(flagged('is-related')).toEqual(['block:channels', 'block:hooks']);
    expect(flagged('is-uses')).toEqual(['block:orders', 'block:people', 'block:roles', 'block:selling', 'block:users']);
  });

  it('keeps the uses places out of the dimmed rest', () => {
    select('block:core:bot-b');

    expect(item('block:users').classList.contains('is-dim')).toBe(false);
    expect(item('block:core:gate').classList.contains('is-dim')).toBe(true);
    expect(item('block:users').classList.contains('is-related')).toBe(false);
  });

  it('draws a uses shape with a solid thinner outline, a tinted fill and less opacity than a related one', () => {
    const uses = rule('.mv-item.is-uses > .mv-shape');
    expect(uses).not.toContain('stroke-dasharray');
    expect(widthOf(uses)).toBeLessThan(widthOf(rule('.mv-item.is-related > .mv-shape')));
    expect(rule('.mv-item.is-uses > .mv-shape {')).toContain('fill:');
    expect(opacityOf(rule('.mv-item.is-uses {'))).toBeLessThan(opacityOf(rule('.mv-item.is-related {')));
  });

  it('lights a place once: a partner is related and not uses', () => {
    select('block:core:bot-a');

    expect(flagged('is-related')).toContain('block:selling');
    expect(flagged('is-uses')).not.toContain('block:selling');
  });

  it('lights nothing as uses for a selection that is not a platform', () => {
    select('block:selling');

    expect(flagged('is-uses')).toEqual([]);
  });
});
