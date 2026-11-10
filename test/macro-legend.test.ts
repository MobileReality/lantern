import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLAT_LEGEND, AREAS_HELP, AREAS_LEGEND, FLAT_HELP, legendEntries, legendText } from '../src/renderer/lib/lanternmacrolegend';
import type { LegendEntry, LegendWhen } from '../src/renderer/lib/lanternmacrolegend';
import { legendHtml, swatchHtml } from '../src/renderer/lib/lanternmacrolegendhtml';
import { UNLEGENDED_STYLES, MACRO_STYLE_CLASSES } from '../src/renderer/lib/lanternmacrostyles';
import type { MacroStyle } from '../src/renderer/lib/lanternmacrostyles';

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const MACRO_VIEW_DIR = path.join(RENDERER, 'lib', 'macroview');
const CSS = fs.readFileSync(path.join(RENDERER, 'lantern-macroview.css'), 'utf8');
const ROOT_MODES = ['is-keyboard', 'is-panning', 'is-dimmed'];
const UNSTYLED: MacroStyle[] = ['main', 'tally'];
const MAX_TEXT = 40;
const ALL_WHEN: LegendWhen[] = ['always', 'selection', 'block', 'links', 'uses', 'pr', 'reading', 'flow', 'pending', 'systems', 'system'];

const styles = Object.keys(MACRO_STYLE_CLASSES) as MacroStyle[];
const sourcesOfMacroView = fs.readdirSync(MACRO_VIEW_DIR).filter((name) => name.endsWith('.ts')).map((name) => ({ name, text: fs.readFileSync(path.join(MACRO_VIEW_DIR, name), 'utf8') }));
const cssLines = CSS.split('\n');
const classOf = (entry: LegendEntry) => (entry.swatch.kind === 'shape' || entry.swatch.kind === 'ribbon' || entry.swatch.kind === 'pill' ? entry.swatch.classes : []);

describe('the areas map legend and the paint code share one list of styles', () => {
  it('has exactly one legend entry for every style the paint code uses, except the keyboard focus ring', () => {
    for (const style of styles) {
      const owners = AREAS_LEGEND.filter((entry) => entry.covers.includes(style));
      expect(owners.length, `${style} (${MACRO_STYLE_CLASSES[style]})`).toBe(UNLEGENDED_STYLES.includes(style) ? 0 : 1);
    }
    expect(UNLEGENDED_STYLES).toEqual(['focus']);
  });

  it('draws every swatch with the classes of the styles its entry covers, and nothing else', () => {
    for (const entry of AREAS_LEGEND) {
      const covered = entry.covers.map((style) => MACRO_STYLE_CLASSES[style]) as string[];
      for (const name of classOf(entry)) expect(covered, `${entry.id} swatch class ${name}`).toContain(name);
      if (entry.swatch.kind === 'chip') expect(covered).toContain(MACRO_STYLE_CLASSES.system);
    }
  });

  it('gives no two entries the same swatch', () => {
    const all = [...AREAS_LEGEND, ...FLAT_LEGEND].map((entry) => JSON.stringify(entry.swatch));
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(AREAS_LEGEND.map((entry) => entry.id)).size).toBe(AREAS_LEGEND.length);
    expect(new Set(FLAT_LEGEND.map((entry) => entry.id)).size).toBe(FLAT_LEGEND.length);
  });

  it('never writes a style class as a literal in the paint code: it comes from the shared list', () => {
    const literal = (value: string) => new RegExp(`['"\`.]${value}(?![\\w-])`);
    for (const { name, text } of sourcesOfMacroView) for (const style of styles) expect(text, `${name} spells ${MACRO_STYLE_CLASSES[style]}`).not.toMatch(literal(MACRO_STYLE_CLASSES[style]));
  });

  it('styles in the stylesheet only the classes of the shared list', () => {
    const known = new Set<string>([...Object.values(MACRO_STYLE_CLASSES), ...ROOT_MODES]);
    const used = new Set([...CSS.matchAll(/\.((?:is|mv)-[a-z]+(?:-[a-z]+)*)/g)].map((match) => match[1]).filter((name) => name.startsWith('is-') || /^mv-(pending|tally|mark|count|system)$/.test(name)));
    for (const name of used) expect(known.has(name), `.${name} in lantern-macroview.css`).toBe(true);
    for (const style of styles) if (!UNSTYLED.includes(style)) expect(used.has(MACRO_STYLE_CLASSES[style]), `${MACRO_STYLE_CLASSES[style]} has a rule`).toBe(true);
  });

  it('keeps the dashed outline for one meaning only: features that are not in an area yet', () => {
    const dashed = cssLines.filter((line) => /dash/.test(line));
    expect(dashed).toHaveLength(1);
    expect(dashed[0]).toContain(`.${MACRO_STYLE_CLASSES.pending} `);
    for (const entry of AREAS_LEGEND) expect(classOf(entry).includes(MACRO_STYLE_CLASSES.pending), entry.id).toBe(entry.id === 'pending');
    for (const { name, text } of sourcesOfMacroView) expect(text, name).not.toMatch(/dash/i);
  });

  it('draws nothing in the legend that says the dashed outline is an outside system', () => {
    const html = legendHtml('areas', new Set(ALL_WHEN), 8) + legendHtml('flat', new Set(ALL_WHEN), 8);
    expect(html).not.toContain('not in the repo');
    expect(html).not.toMatch(/dasharray/);
    expect(swatchHtml({ kind: 'chip' })).not.toMatch(/dash/);
  });
});

describe('the legend text', () => {
  it('is a few words for each swatch, and at most two lines of interaction help', () => {
    for (const entry of [...AREAS_LEGEND, ...FLAT_LEGEND]) expect(legendText(entry, 8).length, entry.id).toBeLessThanOrEqual(MAX_TEXT);
    expect(AREAS_HELP.length).toBeLessThanOrEqual(2);
    expect(FLAT_HELP.length).toBeLessThanOrEqual(2);
  });

  it('puts the strong-link threshold into the flat legend', () => {
    const entries = legendEntries('flat', new Set());
    expect(entries.map((entry) => legendText(entry, 8))).toEqual(['Strong link, 8+ relations', 'Weaker link, fewer than 8']);
  });

  it('shows at rest only the main link, and a style once it can appear', () => {
    expect(legendEntries('areas', new Set()).map((entry) => entry.id)).toEqual(['main']);
    expect(legendEntries('areas', new Set<LegendWhen>(['selection', 'pr'])).map((entry) => entry.id)).toEqual(['main', 'selected', 'related', 'dim', 'lit']);
    expect(legendEntries('areas', new Set<LegendWhen>(['selection', 'links'])).map((entry) => entry.id)).toContain('hot');
    expect(legendEntries('areas', new Set(ALL_WHEN)).map((entry) => entry.id)).toEqual(AREAS_LEGEND.map((entry) => entry.id));
  });

  it('renders each entry as a swatch and its words', () => {
    const html = legendHtml('areas', new Set(ALL_WHEN), 8);
    for (const entry of AREAS_LEGEND) expect(html).toContain(`data-legend="${entry.id}"`);
    expect(html).toContain(`<g class="mv-item mv-feature ${MACRO_STYLE_CLASSES.uses}">`);
    expect(html).toContain(`<g class="mv-item mv-area ${MACRO_STYLE_CLASSES.pending}">`);
    expect(html.match(/<h2>/g)).toHaveLength(1);
  });
});
