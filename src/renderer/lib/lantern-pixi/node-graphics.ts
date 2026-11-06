import { Assets, BitmapText, Container, Graphics, Sprite } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { tileFontSize } from '../lanterncollapse';
import { isWip } from '../lanternlayout';
import type { Pos } from '../lanternlayout';
import { tileSlots } from '../lanterntile';
import type { Profile } from '../lanternprofile';
import type { PixiPalette } from './palette';
import type { FileMark } from '../lanternprpanel';
import { fileIconUrl } from '../file-icons';
import { VIEW, say } from '@shared/lantern-plan-messages';
import { captionOf } from '../lanternmacro';
import { markCaption } from '../lanternmacromarks';
import type { BlockMark } from '../lanternmacromarks';
import { PURPOSE_LINE_H } from '../lanternmacrocards';
import { FLAT_LINE } from '../lanternmacrostyles';
import { actionsWidth, drawFileActions } from './open-actions';
import type { FileActions } from './open-actions';

const CARD_TEXT_Y = 4;

export interface PixiFonts {
  mono: string;
  monoGroup: string;
  monoBold: string;
  monoTile: string;
}

const TILE_CHAR_RATIO = 0.6;
const TILE_STACK = 4;
const TILE_PAD = 14;
const BLOCK_NAME_PX = 13;
const BLOCK_CAPTION_PX = 9.5;
const BLOCK_TEXT_GAP = 4;
const BLOCK_PURPOSE_PX = 10;
const BLOCK_QUIET_ALPHA = 0.45;
const CHANGED_INK = 0x1d1300;
const OPEN_CHEVRON_SIZE = 5;
const OPEN_CHEVRON_INSET = 12;
const OPEN_BADGE_TEXT = 'READING';
const OPEN_BADGE_PAD = 5;
const OPEN_BADGE_H = 14;

function truncate(value: string, room: number) {
  return value.length > room ? `${value.slice(0, room - 1)}…` : value;
}

export function createText(text: string, size: number, fill: number, family: string) {
  return new BitmapText({ text, style: { fontFamily: family, fontSize: size, fill } });
}

function truncateLeft(value: string, room: number) {
  if (room <= 1) return '…';
  return value.length > room ? `…${value.slice(value.length - room + 1)}` : value;
}

function dashedBorder(width: number, height: number, color: number) {
  const border = new Graphics();
  const dash = 5;
  const gap = 3;
  for (let x = 3; x < width - 3; x += dash + gap) {
    border.moveTo(x, 0).lineTo(Math.min(x + dash, width - 3), 0);
    border.moveTo(x, height).lineTo(Math.min(x + dash, width - 3), height);
  }
  for (let y = 3; y < height - 3; y += dash + gap) {
    border.moveTo(0, y).lineTo(0, Math.min(y + dash, height - 3));
    border.moveTo(width, y).lineTo(width, Math.min(y + dash, height - 3));
  }
  return border.stroke({ color, width: 1.5 });
}

function tileDisplay(position: Pos, palette: PixiPalette, fonts: PixiFonts, scale: number, activate: () => void) {
  const tile = position.item.tile as NonNullable<Pos['item']['tile']>;
  const accent = palette.layers[position.col.layer.id] ?? palette.layers.support;
  const display = new Container();
  display.position.set(position.x, position.y);
  display.eventMode = 'static';
  display.cursor = 'pointer';
  const w = position.w - TILE_STACK;
  const h = position.h - TILE_STACK;
  display.addChild(
    new Graphics().roundRect(TILE_STACK, TILE_STACK, w, h, 3).fill(palette.surface).stroke({ color: palette.rule, width: 1 }),
    new Graphics().roundRect(0, 0, w, h, 3).fill(palette.surface).stroke({ color: palette.rule, width: 1 }),
    new Graphics().roundRect(0, 0, 5, h, 1.5).fill(accent),
  );
  const size = tileFontSize(scale);
  const suffix = ` · ${tile.count}`;
  const room = Math.floor((w - TILE_PAD - 8) / (size * TILE_CHAR_RATIO)) - suffix.length;
  const label = createText(`${truncateLeft(position.item.dir, room)}${suffix}`, size, palette.ink, fonts.monoTile);
  label.position.set(TILE_PAD, (h - size * 1.2) / 2);
  display.addChild(label);
  display.on('pointertap', (event: FederatedPointerEvent) => {
    event.stopPropagation();
    activate();
  });
  return display;
}

function openFileBadge(position: Pos, palette: PixiPalette, fonts: PixiFonts) {
  const badge = new Container();
  const text = createText(OPEN_BADGE_TEXT, BLOCK_CAPTION_PX, palette.background, fonts.monoBold);
  const width = text.width + 2 * OPEN_BADGE_PAD;
  badge.addChild(new Graphics().roundRect(-4, -4, position.w + 8, position.h + 8, 6).stroke({ color: palette.ref, width: FLAT_LINE.readingFrameWidth }));
  badge.addChild(new Graphics().roundRect(position.w - width - 8, -9, width, OPEN_BADGE_H, 3).fill(palette.ref));
  text.position.set(position.w - width - 8 + OPEN_BADGE_PAD, -9 + (OPEN_BADGE_H - BLOCK_CAPTION_PX * 1.2) / 2);
  badge.addChild(text);
  return badge;
}

function openChevron(position: Pos, color: number) {
  const x = position.w - OPEN_CHEVRON_INSET;
  const y = position.h / 2;
  return new Graphics().moveTo(x - OPEN_CHEVRON_SIZE, y - OPEN_CHEVRON_SIZE).lineTo(x, y).lineTo(x - OPEN_CHEVRON_SIZE, y + OPEN_CHEVRON_SIZE).stroke({ color, width: 1.6, join: 'round', cap: 'round' });
}

function blockDisplay(position: Pos, palette: PixiPalette, fonts: PixiFonts, activate: () => void, mark: BlockMark | undefined, current: boolean, calm: boolean) {
  const block = position.item.block as NonNullable<Pos['item']['block']>;
  const accent = block.kind === 'core' ? palette.layers.support : block.kind === 'stub' ? palette.layers.edge : palette.layers.domain;
  const display = new Container();
  display.position.set(position.x, position.y);
  display.eventMode = 'static';
  display.cursor = 'pointer';
  const quiet = block.kind === 'core' && !mark;
  const lit = !!mark && !calm;
  if (lit) {
    display.addChild(
      new Graphics().roundRect(-3, -3, position.w + 6, position.h + 6, 6).stroke({ color: palette.glow, width: 6, alpha: 0.12 }),
      new Graphics().roundRect(-1.5, -1.5, position.w + 3, position.h + 3, 4.5).stroke({ color: palette.glow, width: 3, alpha: 0.2 }),
    );
  }
  display.addChild(
    new Graphics().roundRect(0, 0, position.w, position.h, 3).fill(palette.surface).stroke({ color: lit ? palette.glow : palette.rule, width: lit ? FLAT_LINE.litFrameWidth : FLAT_LINE.restFrameWidth }),
    new Graphics().roundRect(0, 0, 5, position.h, 1.5).fill({ color: lit ? palette.glow : accent, alpha: quiet ? BLOCK_QUIET_ALPHA : 1 }),
  );
  if (mark && calm) display.addChild(new Graphics().roundRect(0, 0, position.w, position.h, 3).stroke({ color: palette.ink3, width: 1, alpha: 0.7 }));
  const room = Math.floor((position.w - TILE_PAD - 8) / (BLOCK_NAME_PX * TILE_CHAR_RATIO));
  const name = createText(truncate(position.item.label, room), BLOCK_NAME_PX, quiet ? palette.ink3 : palette.ink, fonts.monoTile);
  if (block.unplaced) display.addChild(dashedBorder(position.w, position.h, palette.ink3));
  if (block.opens) display.addChild(openChevron(position, palette.ink3));
  const caption = createText(mark ? markCaption(mark) : captionOf(block), BLOCK_CAPTION_PX, lit ? CHANGED_INK : palette.ink3, fonts.monoGroup);
  const purposeHeight = block.lines.length ? BLOCK_TEXT_GAP + block.lines.length * PURPOSE_LINE_H : 0;
  const top = (position.h - BLOCK_NAME_PX * 1.2 - BLOCK_CAPTION_PX * 1.2 - BLOCK_TEXT_GAP - purposeHeight) / 2;
  name.position.set(TILE_PAD, top);
  display.addChild(name);
  block.lines.forEach((line, index) => {
    const text = createText(line, BLOCK_PURPOSE_PX, palette.ink2, fonts.mono);
    text.position.set(TILE_PAD, top + BLOCK_NAME_PX * 1.2 + BLOCK_TEXT_GAP + index * PURPOSE_LINE_H);
    display.addChild(text);
  });
  const captionY = top + BLOCK_NAME_PX * 1.2 + BLOCK_TEXT_GAP + purposeHeight;
  caption.position.set(TILE_PAD, captionY);
  if (lit) display.addChild(new Graphics().roundRect(TILE_PAD - 4, captionY - 1, caption.width + 8, BLOCK_CAPTION_PX * 1.2 + 2, 2).fill(palette.glow));
  display.addChild(caption);
  if (current) display.addChild(openFileBadge(position, palette, fonts));
  display.on('pointertap', (event: FederatedPointerEvent) => {
    event.stopPropagation();
    activate();
  });
  return display;
}

type PrTint = FileMark | 'off';

export function nodeDisplay(position: Pos, profile: Profile, palette: PixiPalette, fonts: PixiFonts, scale: number, activate: () => void, tint: PrTint | undefined, requestRender: () => void, trackIcon: (load: Promise<void>) => void, actions: FileActions | null = null, blockMark?: BlockMark, current = false, calm = false) {
  if (position.item.tile) return tileDisplay(position, palette, fonts, scale, activate);
  if (position.item.block) return blockDisplay(position, palette, fonts, activate, blockMark, current, calm);
  const node = position.item.node;
  const layer = profile.layerOf(node?.role ?? 'other').id;
  const accent = palette.layers[layer] ?? palette.layers.support;
  const display = new Container();
  display.position.set(position.x, position.y);
  display.eventMode = 'static';
  display.cursor = node || position.item.boundary ? 'pointer' : 'default';
  const related = tint === 'related';
  const mark = tint && tint !== 'off' && !related ? tint : node && isWip(node) ? node.marker : '';
  const wip = !!mark;
  if (wip) {
    display.addChild(
      new Graphics().roundRect(-3, -3, position.w + 6, position.h + 6, 6).stroke({ color: palette.glow, width: 6, alpha: 0.12 }),
      new Graphics().roundRect(-1.5, -1.5, position.w + 3, position.h + 3, 4.5).stroke({ color: palette.glow, width: 3, alpha: 0.2 }),
    );
  }
  const box = new Graphics().roundRect(0, 0, position.w, position.h, 3).fill(node ? palette.surface : { color: palette.background, alpha: 0 }).stroke({ color: wip || related ? palette.glow : palette.rule, width: wip ? FLAT_LINE.litFrameWidth : FLAT_LINE.restFrameWidth });
  display.addChild(box);
  if (node) display.addChild(new Graphics().roundRect(0, 0, 4, position.h, 1.5).fill(isWip(node) ? palette.glow : accent));
  const iconPath = node?.path ?? position.item.boundary?.path;
  if (iconPath) trackIcon(Assets.load(fileIconUrl(iconPath)).then((texture) => {
    if (!display.destroyed) {
      const icon = new Sprite(texture);
      icon.position.set(node ? 10 : 7, 4);
      icon.width = 15;
      icon.height = 15;
      display.addChild(icon);
      requestRender();
    }
  }).catch(() => undefined));
  const badge = node && related ? say(VIEW.BADGE_PLAN_RELATED) : node && tint && tint !== 'off' ? (node.prNew ? 'new' : node.planNew ? say(VIEW.BADGE_PLAN_NEW) : tint) : node && isWip(node) ? truncate(node.marker + (node.owner ? `@${node.owner}` : ''), 12) : node?.freshness === 'gone' ? 'gone' : '';
  const slots = tileSlots({ width: position.w, label: position.item.label, badge, hasIcon: !!iconPath, isNode: !!node, actionsWidth: actionsWidth(actions) });
  const { badgeWidth, badgeRight: right } = slots;
  if (slots.badge) {
    const badgeBox = new Graphics().roundRect(right - badgeWidth - 3, 3, badgeWidth, position.h - 6, 2).fill(node?.freshness === 'gone' ? palette.ink3 : palette.glow);
    const badgeText = createText(slots.badge, 9.5, 0x1d1300, fonts.monoBold);
    badgeText.position.set(right - badgeWidth + 2, 4);
    display.addChild(badgeBox, badgeText);
  }
  const label = createText(slots.label, 11.5, node?.freshness === 'gone' ? palette.ink3 : palette.ink, fonts.mono);
  label.position.set(slots.labelX, CARD_TEXT_Y);
  display.addChild(label);
  display.on('pointertap', (event: FederatedPointerEvent) => {
    event.stopPropagation();
    activate();
  });
  if (node?.prNew || node?.planNew || mark === '+') display.addChild(dashedBorder(position.w, position.h, palette.glow));
  if (node?.freshness === 'gone' || mark === '-') display.addChild(new Graphics().moveTo(8, position.h / 2).lineTo(right - badgeWidth - 7, position.h / 2).stroke({ color: palette.ink3, width: 1.5 }));
  if (actions) drawFileActions(display, position.w, position.h, palette, actions);
  return display;
}
