import { blockName, isFoundationId, platformName, platformOfFoundation, systemName } from '../../shared/lantern-names';

const PURPOSE_MAX_LINES = 2;
const ELLIPSIS = '…';

function fitLine(line: string, room: number) {
  return line.length <= room ? line : `${line.slice(0, Math.max(1, room - 1)).trimEnd()}${ELLIPSIS}`;
}

function wrapPurpose(text: string, room: number, maxLines = PURPOSE_MAX_LINES): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  let used = 0;
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= room || !current) {
      current = next;
      used += 1;
      continue;
    }
    lines.push(current);
    if (lines.length === maxLines) return [...lines.slice(0, -1), fitLine(`${lines[maxLines - 1]} ${words.slice(used).join(' ')}`, room)];
    current = word;
    used += 1;
  }
  if (current) lines.push(current);
  return lines.map((line) => fitLine(line, room));
}

export { blockName, isFoundationId, platformName, platformOfFoundation, systemName, wrapPurpose };
