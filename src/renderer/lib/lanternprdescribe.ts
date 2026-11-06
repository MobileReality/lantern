import type { LanternPr, LanternPrDescription, LanternPrDescriptionSection } from '../../main/lantern';

const LEAD_MAX_CHARS = 280;
const LEAD_MAX_LINES = 4;
const HOST_CLASS = 'pr-describe';

interface DescribePart {
  label?: string;
  lines: string[];
}

interface DescribeBlock {
  title: string;
  parts: DescribePart[];
}

const BLOCKS: { title: string; parts: { section: LanternPrDescriptionSection; label?: string }[] }[] = [
  { title: 'What changes', parts: [{ section: 'what' }] },
  {
    title: 'Before / after',
    parts: [
      { section: 'before', label: 'Before' },
      { section: 'after', label: 'After' },
    ],
  },
  { title: 'Verification', parts: [{ section: 'verified' }] },
];

function describeBlocks(description: LanternPrDescription | undefined): DescribeBlock[] {
  if (!description) return [];
  return BLOCKS.flatMap((block) => {
    const parts = block.parts.flatMap(({ section, label }) => {
      const lines = description[section] ?? [];
      return lines.length > 0 ? [{ ...(label ? { label } : {}), lines }] : [];
    });
    return parts.length > 0 ? [{ title: block.title, parts }] : [];
  });
}

function isLongDescription(blocks: DescribeBlock[]) {
  const lines = blocks.flatMap((b) => b.parts.flatMap((p) => p.lines));
  return lines.length > LEAD_MAX_LINES || lines.join('').length > LEAD_MAX_CHARS;
}

function leadBlocks(blocks: DescribeBlock[]): DescribeBlock[] {
  const first = blocks[0];
  const part = first?.parts[0];
  return first && part ? [{ title: first.title, parts: [{ ...(part.label ? { label: part.label } : {}), lines: part.lines.slice(0, 1) }] }] : [];
}

function element(tag: string, className: string | null, text?: string) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function blockElement(block: DescribeBlock) {
  const section = element('section', 'pr-desc-block');
  section.append(element('h3', 'pr-desc-title', block.title));
  for (const part of block.parts) {
    if (part.label) section.append(element('div', 'pr-desc-label', part.label));
    const list = element('ul', 'pr-desc-lines');
    for (const line of part.lines) list.append(element('li', null, line));
    section.append(list);
  }
  return section;
}

function descriptionHostHtml(pr: LanternPr) {
  return describeBlocks(pr.description).length > 0 ? `<div class="${HOST_CLASS}"></div>` : '';
}

function fillDescription(host: Element, pr: LanternPr, expanded: boolean, onToggle: () => void) {
  const blocks = describeBlocks(pr.description);
  const long = isLongDescription(blocks);
  const collapsed = long && !expanded;
  host.replaceChildren(...(collapsed ? leadBlocks(blocks) : blocks).map(blockElement));
  host.classList.toggle('collapsed', collapsed);
  if (!long) return;
  const toggle = element('button', 'pr-desc-toggle', expanded ? 'Hide details' : 'Show details');
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.addEventListener('click', onToggle);
  host.append(toggle);
}

function fillDescriptions(root: ParentNode, pr: LanternPr, isExpanded: () => boolean, onToggle: () => void) {
  const redraw = () => {
    for (const host of root.querySelectorAll(`.${HOST_CLASS}`)) fillDescription(host, pr, isExpanded(), toggle);
  };
  const toggle = () => {
    onToggle();
    redraw();
  };
  redraw();
}

export { descriptionHostHtml, describeBlocks, fillDescriptions, isLongDescription };
