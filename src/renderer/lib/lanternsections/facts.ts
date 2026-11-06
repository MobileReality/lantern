import type { FactsSection } from '../../../main/lantern';
import { esc } from '../lanternctx';
import { citesHtml, fieldText, noteHtml } from './common';
import type { Renderer } from './common';

const factsRenderer: Renderer<FactsSection> = {
  label: 'Facts',
  noun: 'facts',
  count: (sec) => sec.items.length,
  body: (ctx, sec) => {
    const items = sec.items.map((i) => `<li><p>${i.text ? fieldText(ctx, `item ${i.id}`, i.text) : esc(i.id)}</p>${noteHtml(ctx, `item ${i.id} note`, i.note)}${citesHtml(ctx, i.cites)}</li>`);
    return `<ul class="sx-facts">${items.join('')}</ul>`;
  },
};

export { factsRenderer };
