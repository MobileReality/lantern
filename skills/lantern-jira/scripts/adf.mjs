const BULLET = /^\s*[-*]\s+(.*)$/;
const BLOCK_SPLIT = /\n{2,}/;

const textNode = (text) => ({ type: 'text', text });

function paragraph(lines) {
  const content = lines
    .filter((line) => line.trim() !== '')
    .flatMap((line, index) => (index === 0 ? [textNode(line)] : [{ type: 'hardBreak' }, textNode(line)]));
  return { type: 'paragraph', content };
}

const bulletList = (lines) => ({
  type: 'bulletList',
  content: lines.map((line) => ({ type: 'listItem', content: [paragraph([BULLET.exec(line)[1]])] })),
});

const BLOCK_BUILDERS = [
  { matches: (lines) => lines.every((line) => BULLET.test(line)), build: bulletList },
  { matches: () => true, build: paragraph },
];

const blockToNode = (block) => {
  const lines = block.split('\n');
  return BLOCK_BUILDERS.find((builder) => builder.matches(lines)).build(lines);
};

export function textToAdf(text) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const content = normalized === '' ? [] : normalized.split(BLOCK_SPLIT).map(blockToNode);
  return { type: 'doc', version: 1, content };
}

const closeBlock = (_node, inner) => `${inner}\n`;

const RENDERERS = Object.freeze({
  text: (node) => node.text ?? '',
  hardBreak: () => '\n',
  paragraph: closeBlock,
  heading: closeBlock,
  codeBlock: closeBlock,
  blockquote: closeBlock,
  listItem: (_node, inner) => `- ${inner.trim()}\n`,
  mention: (node) => node.attrs?.text ?? '',
  inlineCard: (node) => node.attrs?.url ?? '',
  emoji: (node) => node.attrs?.text ?? node.attrs?.shortName ?? '',
});

export function adfToText(node) {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';
  const inner = (node.content ?? []).map(adfToText).join('');
  return (RENDERERS[node.type] ?? ((_node, text) => text))(node, inner);
}
