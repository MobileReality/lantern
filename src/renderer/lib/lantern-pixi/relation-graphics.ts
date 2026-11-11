import { Container, Graphics, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { GROUP_CHAR_W, NAME_CHAR_W } from '../lanternlayout';
import type { RelationLayout, Refs, Side, Zone } from '../lanternrelview';
import type { PixiPalette } from './palette';
import { drawEdge } from './edge-graphics';
import type { Profile } from '../lanternprofile';
import { isPrimaryTap } from './open-actions';

const ZONE_NAMES: Record<Side, Record<Refs, string>> = {
  in: { none: 'Takes data from', mixed: 'Takes data from, referred to by', all: 'Referred to by' },
  out: { none: 'Sends data into', mixed: 'Sends data into, refers to', all: 'Refers to' },
  both: { none: 'Both ways', mixed: 'Both ways', all: 'Refer to each other' },
};

function zoneColor(zone: Zone, palette: PixiPalette) {
  if (zone.refs === 'all') return palette.ref;
  if (zone.side === 'in') return palette.take;
  if (zone.side === 'both') return palette.both;
  return zone.side === 'out' ? palette.send : palette.ink3;
}

function truncateLeft(value: string, room: number) {
  return value.length > room ? `…${value.slice(value.length - room + 1)}` : value;
}

interface RelationGraphicsOptions {
  layout: RelationLayout;
  palette: PixiPalette;
  pinnedAreas: ReadonlySet<string>;
  hoveredArea: string | null;
  onArea: (key: string) => void;
  onAreaHover: (key: string | null) => void;
  profile: Profile;
  resolution: number;
}

function relationGraphics(options: RelationGraphicsOptions) {
  const { layout, palette } = options;
  const text = (value: string, size: number, fill: number, weight: '400' | '600' | '700' = '400') => new Text({ text: value, resolution: options.resolution, style: { fontFamily: palette.mono, fontSize: size, fill, fontWeight: weight } });
  const container = new Container();
  const zones = new Container();
  const edges = new Container();
  const areas = new Container();
  container.addChild(zones, edges, areas);
  for (const zone of layout.zones) {
    const color = zoneColor(zone, palette);
    zones.addChild(new Graphics().roundRect(zone.x - 10, zone.y, zone.w + 20, zone.h, 8).fill({ color, alpha: zone.side === 'centre' ? 0 : 0.06 }).stroke({ color: zone.side === 'centre' ? palette.rule : color, alpha: 0.4, width: 1 }));
    if (zone.side !== 'centre') {
      const heading = text(ZONE_NAMES[zone.side][zone.refs], 11.5, color, '700');
      heading.position.set(zone.x, zone.y + 12);
      heading.style.wordWrap = true;
      heading.style.wordWrapWidth = zone.w;
      const count = text(`${zone.count} file${zone.count === 1 ? '' : 's'}`, 9.5, palette.ink3, '600');
      count.position.set(zone.x, zone.y + 43);
      zones.addChild(heading, count);
    }
    for (const group of zone.groups) {
      zones.addChild(new Graphics().moveTo(group.x, group.y + 6).lineTo(group.x + group.w, group.y + 6).stroke({ color: palette.rule, width: 1 }));
      const label = text(truncateLeft(group.dir, Math.floor(group.w / GROUP_CHAR_W)), 9.5, palette.ink3, '600');
      label.position.set(group.x, group.y + 8);
      zones.addChild(label);
    }
    for (const area of zone.areas) {
      const areaContainer = new Container();
      areaContainer.eventMode = 'static';
      areaContainer.cursor = 'pointer';
      const pinned = options.pinnedAreas.has(area.key) || options.hoveredArea === area.key;
      areaContainer.addChild(new Graphics().roundRect(area.x, area.y, area.w, area.h, 10).fill({ color, alpha: pinned ? 0.16 : 0.07 }).stroke({ color, alpha: pinned ? 1 : 0.55, width: pinned ? 2 : 1 }));
      const name = text(truncateLeft(area.dir || '(root)', Math.max(4, Math.floor(area.w / GROUP_CHAR_W) - 12)), 9.5, palette.ink, '600');
      name.position.set(area.x + 9, area.y + 7);
      const count = text(`${area.keys.length} files`, 9.5, color, '700');
      count.position.set(area.x + area.w - count.width - 9, area.y + 7);
      areaContainer.addChild(name, count);
      areaContainer.on('pointertap', (event: FederatedPointerEvent) => {
        if (!isPrimaryTap(event)) return;
        event.stopPropagation();
        options.onArea(area.key);
      });
      areaContainer.on('pointerover', () => options.onAreaHover(area.key));
      areaContainer.on('pointerout', () => options.onAreaHover(null));
      areas.addChild(areaContainer);
    }
  }
  for (const edge of layout.edges) {
    const color = edge.ref ? palette.ref : edge.side === 'in' ? palette.take : edge.side === 'both' ? palette.both : palette.send;
    const arrow = edge.side === 'both' ? '=' : '>';
    const active = !!edge.area && (options.pinnedAreas.has(edge.key) || options.hoveredArea === edge.key);
    const graphic = drawEdge(edge.curve, edge.ref ? 'ref' : edge.side === 'both' ? 'both' : edge.side === 'in' ? 'take' : 'send', arrow, color, active ? 3.4 : edge.area ? 2.6 : layout.edges.length > 40 ? 1.1 : 1.7);
    graphic.alpha = active ? 1 : layout.edges.length > 40 ? 0.5 : 0.85;
    edges.addChild(graphic);
  }
  const centre = layout.pos.get(layout.centre);
  if (centre?.item.node) {
    const role = centre.item.node.role;
    const caption = text(truncateLeft(`${role} · ${options.profile.layerOf(role).name}`, Math.floor(centre.w / NAME_CHAR_W) + 6), 9.5, palette.ink3, '600');
    caption.position.set(centre.x, centre.y + centre.h + 8);
    container.addChild(caption);
  }
  if (layout.count === 1 && centre) {
    const empty = text('No relations to show.', 11.5, palette.ink3);
    empty.position.set(centre.x, centre.y + centre.h + 42);
    container.addChild(empty);
  }
  return container;
}

export { relationGraphics };
