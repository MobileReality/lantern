import { REGION_NAME, SHOW_ALL_SHORTCUT, shortcutOf, shortcutTarget, shortcutsHint } from './lanternregions';
import type { Region, Regions } from './lanternregions';

interface RegionTools {
  setActive(on: boolean): void;
  attachList(): void;
  paint(): void;
  handleKey(ev: KeyboardEvent): boolean;
  dispose(): void;
}

interface ToolsOptions {
  grid: HTMLElement;
  side: HTMLElement;
  viewer: HTMLElement;
  main: HTMLElement;
  regions: Regions;
  foundationPresent(): boolean;
  reset(): void;
  say(text: string): void;
}

type Collapsible = Exclude<Region, 'foundation'>;

const MUST_STAY_TEXT = 'The file viewer or the graph has to stay visible.';
const NO_FOUNDATION_TEXT = 'The shared foundation is only drawn in the Macro view.';
const RESET_LABEL = 'Reset layout';
const PANEL_X: Record<Collapsible, string> = { list: '2', viewer: '6.2', graph: '10.4' };

function panelIcon(region: Collapsible) {
  return `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor"/><rect x="${PANEL_X[region]}" y="4" width="3.6" height="8" rx="0.6" fill="currentColor"/></svg>`;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

function iconButton(region: Collapsible) {
  const button = element('button', 'lt-region-btn');
  button.type = 'button';
  button.dataset.region = region;
  button.innerHTML = panelIcon(region);
  return button;
}

function mountRegionTools(options: ToolsOptions): RegionTools {
  const { grid, side, viewer, main, regions, say } = options;
  let active = false;
  const buttons: Record<Collapsible, HTMLButtonElement> = { list: iconButton('list'), viewer: iconButton('viewer'), graph: iconButton('graph') };
  const listTools = element('div', 'lt-region-tools lt-region-tools-list');
  const graphTools = element('div', 'lt-region-tools lt-region-tools-graph');
  const foundation = element('button', 'lt-region-pill');
  foundation.type = 'button';
  foundation.dataset.region = 'foundation';
  const bar = element('div', 'lt-layoutbar');
  const hint = element('span', 'lt-layoutbar-hint');
  hint.textContent = 'Layout';
  hint.dataset.tip = shortcutsHint();
  const reset = element('button', 'lt-layoutbar-reset');
  reset.type = 'button';
  reset.textContent = RESET_LABEL;
  reset.dataset.tip = `${RESET_LABEL}: show every area again at its default width (${SHOW_ALL_SHORTCUT})`;
  bar.append(hint, reset);
  bar.hidden = true;
  const viewerTools = element('div', 'lt-region-tools lt-region-tools-viewer');
  listTools.append(buttons.list);
  viewerTools.append(buttons.viewer);
  graphTools.append(foundation, buttons.graph);
  viewer.append(viewerTools);
  grid.before(bar);

  function paintHide(region: Collapsible) {
    const button = buttons[region];
    const allowed = regions.canHide(region);
    const name = REGION_NAME[region];
    button.setAttribute('aria-label', `Hide the ${name}`);
    button.dataset.tip = allowed ? `Hide the ${name} (${shortcutOf(region)})` : `${MUST_STAY_TEXT} (${shortcutOf(region)})`;
    button.setAttribute('aria-disabled', String(!allowed));
  }

  function paintFoundation() {
    const present = options.foundationPresent();
    const hidden = regions.isHidden('foundation');
    foundation.hidden = !present;
    foundation.textContent = hidden ? 'Show shared foundation' : 'Hide shared foundation';
    foundation.dataset.tip = `${foundation.textContent} (${shortcutOf('foundation')})`;
  }

  function paint() {
    paintHide('list');
    paintHide('viewer');
    paintHide('graph');
    paintFoundation();
  }

  function attemptHide(region: Region) {
    if (regions.isHidden(region)) return regions.show(region);
    if (region === 'foundation' && !options.foundationPresent()) {
      say(NO_FOUNDATION_TEXT);
      return false;
    }
    const done = regions.hide(region);
    if (!done) say(MUST_STAY_TEXT);
    return done;
  }

  function announce(region: Region | null) {
    if (region === null) return say('Every area is shown again.');
    say(`${regions.isHidden(region) ? 'Hid' : 'Showed'} the ${REGION_NAME[region]}.`);
  }

  for (const region of ['list', 'viewer', 'graph'] as const) buttons[region].addEventListener('click', () => attemptHide(region));
  foundation.addEventListener('click', () => attemptHide('foundation'));
  reset.addEventListener('click', () => options.reset());
  regions.onChange((region) => {
    paint();
    announce(region);
  });

  return {
    setActive(on) {
      active = on;
      bar.hidden = !on;
      if (!on) {
        listTools.remove();
        graphTools.remove();
        return;
      }
      if (!main.contains(graphTools)) main.prepend(graphTools);
      if (!side.contains(listTools)) side.prepend(listTools);
      paint();
    },
    attachList() {
      if (active && !side.contains(listTools)) side.prepend(listTools);
    },
    paint,
    handleKey(ev) {
      if (!active) return false;
      const target = shortcutTarget(ev);
      if (!target) return false;
      ev.preventDefault();
      if (target === 'all') options.reset();
      else attemptHide(target);
      return true;
    },
    dispose() {
      bar.remove();
      listTools.remove();
    },
  };
}

export { mountRegionTools };
export type { RegionTools };
