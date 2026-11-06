const CORE_PREFIX = 'core:';

const WORD_CASE: Readonly<Record<string, string>> = {
  api: 'API',
  cli: 'CLI',
  db: 'DB',
  github: 'GitHub',
  ipc: 'IPC',
  lsp: 'LSP',
  osascript: 'osascript',
  pnpm: 'pnpm',
  pr: 'PR',
  rbac: 'RBAC',
  ui: 'UI',
  vscode: 'VS Code',
  vtsls: 'vtsls',
};

const FOUNDATION_NAMES: Readonly<Record<string, string>> = {
  backend: 'Backend core',
  desktop: 'Desktop shell',
  infra: 'Infrastructure',
  mobile: 'Mobile app shell',
  shared: 'Shared code',
  web: 'Web app shell',
};

function capitalise(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function wordsOf(id: string) {
  return id.split(/[-_\s]+/).filter(Boolean);
}

function sentenceCase(id: string) {
  return wordsOf(id)
    .map((word, index) => WORD_CASE[word.toLowerCase()] ?? (index === 0 ? capitalise(word) : word.toLowerCase()))
    .join(' ');
}

function titleCase(id: string) {
  return wordsOf(id)
    .map((word) => WORD_CASE[word.toLowerCase()] ?? capitalise(word))
    .join(' ');
}

function isFoundationId(id: string) {
  return id.startsWith(CORE_PREFIX);
}

function blockName(id: string) {
  if (!isFoundationId(id)) return sentenceCase(id);
  const platform = id.slice(CORE_PREFIX.length);
  return FOUNDATION_NAMES[platform] ?? sentenceCase(platform);
}

function systemName(system: string) {
  return titleCase(system);
}

function platformName(platform: string) {
  return titleCase(platform);
}

function platformOfFoundation(id: string) {
  return isFoundationId(id) ? id.slice(CORE_PREFIX.length) : null;
}

export { blockName, isFoundationId, platformName, platformOfFoundation, systemName };
