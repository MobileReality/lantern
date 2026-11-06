import { describe, expect, it } from 'vitest';
import { mapOf, node } from './helpers/lantern-map';
import { emptyFilters, layoutGraph, NAME_CHAR_W } from '../src/renderer/lib/lanternlayout';
import { relationLayout } from '../src/renderer/lib/lanternrelview';
import { tileSlots } from '../src/renderer/lib/lanterntile';

const CENTRE = 'src/svc/centre.ts';
const BADGES = ['', 'new', '~', 'gone', '~@someone-long'];
const ACTIONS = [0, 22, 42];
const LABEL_CHAR_FILL = NAME_CHAR_W;

const rel = (from: string, arrow: '>' | '<' | '=', to: string) => ({ from, arrow, to, ext: null, symbol: null, label: '' });

function layoutWith(names: string[]) {
  const paths = names.map((name, i) => `src/repo/${name}${i}.ts`);
  const kinds = ['<', '>', '='] as const;
  const data = mapOf({
    nodes: [node(CENTRE, 'service'), ...paths.map((p) => node(p, 'repository'))],
    relations: paths.map((p, i) => rel(CENTRE, kinds[i % 3], p)),
  });
  return relationLayout(layoutGraph(data, emptyFilters()), CENTRE);
}

describe('relation tiles stay inside their cards', () => {
  const long = 'a-very-long-file-name-that-keeps-going-and-going-for-more-than-sixty-characters';
  const layout = layoutWith([long, 'x', 'mid-length-name', long, 'y', long]);

  it('keeps the label and the badge of every tile within the tile, for every badge and button set', () => {
    for (const placed of layout.pos.values()) {
      for (const badge of BADGES) {
        for (const actionsWidth of ACTIONS) {
          const slots = tileSlots({ width: placed.w, label: placed.item.label, badge, hasIcon: true, isNode: true, actionsWidth });
          const labelEnd = slots.labelX + slots.label.length * LABEL_CHAR_FILL;
          const badgeStart = slots.badgeRight - slots.badgeWidth;
          expect(slots.labelX).toBeGreaterThanOrEqual(0);
          expect(labelEnd).toBeLessThanOrEqual(placed.w - actionsWidth);
          expect(slots.badgeRight).toBeLessThanOrEqual(placed.w - actionsWidth);
          if (slots.badge) {
            expect(badgeStart).toBeGreaterThanOrEqual(slots.labelX);
            expect(labelEnd).toBeLessThanOrEqual(badgeStart);
          }
        }
      }
    }
  });

  it('keeps every tile inside the zone or area that holds it', () => {
    for (const placed of layout.pos.values()) {
      if (placed.item.key === CENTRE) continue;
      const holder = [...layout.zones, ...layout.zones.flatMap((z) => z.areas)].find((h) => placed.x >= h.x && placed.x + placed.w <= h.x + h.w && placed.y >= h.y && placed.y + placed.h <= h.y + h.h);
      expect(holder, placed.item.key).toBeDefined();
    }
  });

  it('shortens a long name with an ellipsis and never returns more characters than fit', () => {
    const slots = tileSlots({ width: 150, label: long, badge: '~@someone-long', hasIcon: true, isNode: true, actionsWidth: 42 });
    expect(slots.label.endsWith('…')).toBe(true);
    expect(slots.label.length).toBeLessThan(long.length);
  });

  it('drops the label rather than overflowing when there is no room at all', () => {
    const slots = tileSlots({ width: 40, label: long, badge: 'new', hasIcon: true, isNode: true, actionsWidth: 42 });
    expect(slots.label).toBe('');
    expect(slots.badge).toBe('');
  });
});
