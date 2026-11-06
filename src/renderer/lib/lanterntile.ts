import { NAME_CHAR_W } from './lanternlayout';

const BADGE_CHAR_W = 6;
const BADGE_PAD = 10;
const BADGE_GAP = 3;
const MIN_LABEL_CHARS = 4;
const ICON_INSET = 38;
const BARE_INSET = 20;
const NODE_ICON_X = 30;
const BOUNDARY_ICON_X = 27;
const NODE_TEXT_X = 12;
const BOUNDARY_TEXT_X = 8;

interface TileSlotsInput {
  width: number;
  label: string;
  badge: string;
  hasIcon: boolean;
  isNode: boolean;
  actionsWidth: number;
}

interface TileSlots {
  label: string;
  labelX: number;
  badge: string;
  badgeWidth: number;
  badgeRight: number;
}

function ellipsize(value: string, room: number) {
  if (room < 1) return '';
  return value.length > room ? `${value.slice(0, room - 1)}…` : value;
}

function tileSlots({ width, label, badge, hasIcon, isNode, actionsWidth }: TileSlotsInput): TileSlots {
  const right = Math.max(0, width - actionsWidth);
  const inset = hasIcon ? ICON_INSET : BARE_INSET;
  const badgeBudget = right - inset - MIN_LABEL_CHARS * NAME_CHAR_W - BADGE_GAP;
  const badgeChars = Math.max(0, Math.floor((badgeBudget - BADGE_PAD) / BADGE_CHAR_W));
  const shownBadge = ellipsize(badge, badgeChars);
  const badgeWidth = shownBadge ? shownBadge.length * BADGE_CHAR_W + BADGE_PAD : 0;
  const room = Math.max(0, Math.floor((right - inset - badgeWidth) / NAME_CHAR_W));
  const labelX = hasIcon ? (isNode ? NODE_ICON_X : BOUNDARY_ICON_X) : isNode ? NODE_TEXT_X : BOUNDARY_TEXT_X;
  return { label: ellipsize(label, room), labelX, badge: shownBadge, badgeWidth, badgeRight: right };
}

export { tileSlots };
export type { TileSlots, TileSlotsInput };
