import { esc } from './lanternctx';
import { plural } from './lanternmacro';

interface Mention {
  key: string;
  name: string;
  count: number;
  noun?: string;
}

function mentionButton(mention: Mention) {
  return `<button data-macro-go="${esc(mention.key)}">${esc(mention.name)}</button> (${plural(mention.count, mention.noun ?? 'relation')})`;
}

function joinWords(parts: string[]) {
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function sentence(lead: string, mentions: Mention[]) {
  return mentions.length ? `<p class="lt-sentence">${lead} ${joinWords(mentions.map(mentionButton))}.</p>` : '';
}

export { joinWords, mentionButton, sentence };
export type { Mention };
