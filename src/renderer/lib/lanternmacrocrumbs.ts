import { esc } from './lanternctx';
import { plural } from './lanternmacro';
import type { MacroGraph } from './lanternmacro';
import { realCards } from './lanternmacrorest';

const AREAS_LABEL = 'Areas';
const UP_TITLE = 'Back to the areas (Escape or Backspace)';

function crumbsHtml(graph: MacroGraph) {
  if (graph.level === 'flat') return '';
  if (graph.level === 'areas') return `<nav class="lt-crumbs" aria-label="Macro level"><ol><li aria-current="location">${AREAS_LABEL}</li></ol></nav>`;
  const name = graph.area?.name ?? '';
  return `<nav class="lt-crumbs" aria-label="Macro level"><ol><li><button type="button" data-macro-up data-tip="${UP_TITLE}">${AREAS_LABEL}</button></li><li class="lt-crumb-sep" aria-hidden="true">›</li><li aria-current="location">${esc(name)}</li></ol></nav>`;
}

function toAssignSentence(graph: MacroGraph) {
  const pending = graph.blocks.find((block) => block.unplaced);
  return pending ? `, and ${plural(pending.members?.length ?? 0, 'feature')} to assign` : '';
}

function levelAnnouncement(graph: MacroGraph | null) {
  if (!graph || graph.level === 'flat') return '';
  if (graph.level === 'areas') return `${AREAS_LABEL}: ${plural(realCards(graph.blocks).length, 'area')}${toAssignSentence(graph)}. Press Enter on an area to open it.`;
  return `Inside ${graph.area?.name ?? 'the area'}: ${plural(graph.blocks.filter((block) => block.kind === 'feature').length, 'feature')}. Press Escape to go back to the ${AREAS_LABEL.toLowerCase()}.`;
}

export { levelAnnouncement, crumbsHtml };
