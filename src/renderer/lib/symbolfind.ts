const MODIFIERS = '(?:(?:export|default|public|private|protected|internal|open|static|async|abstract|final|override|pub|declare|readonly|suspend|data|sealed|inline|unsafe|extern|mutating)\\s+)*';
const KEYWORDS = '(?:function\\*?|const|let|var|class|interface|type|enum|def|func|fn|struct|object|protocol|trait|impl|val|fun|extension|actor|namespace|module)';
const GENERICS = '(?:<[^>]*>\\s*)?';
const NOT_CALL = /^\s*(?:if|for|while|switch|catch|return|else|await|new|throw)\b/;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function declarationPatterns(name: string) {
  const n = escapeRe(name);
  return {
    keyword: [
      new RegExp(`^\\s*${MODIFIERS}${KEYWORDS}\\s+${GENERICS}${n}(?![\\w$])`),
      new RegExp(`^\\s*func\\s*\\([^)]*\\)\\s*${n}(?![\\w$])`),
      new RegExp(`^\\s*def\\s+self\\.${n}(?![\\w$])`),
    ],
    member: [
      new RegExp(`^\\s*${MODIFIERS}(?:(?:get|set)\\s+)?\\*?${n}\\s*${GENERICS}\\([^;]*\\{\\s*$`),
      new RegExp(`^\\s*${MODIFIERS}${n}\\s*[:=]\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>|[\\w$]+\\s*=>)`),
      new RegExp(`^\\s*(?:exports|module\\.exports)\\.${n}\\s*=`),
      new RegExp(`^\\s*${MODIFIERS}${n}\\s*=(?!=)`),
    ],
  };
}

function wordPattern(name: string) {
  return new RegExp(`(?<![\\w$])${escapeRe(name)}(?![\\w$])`);
}

function firstMatch(lines: string[], patterns: RegExp[], skip?: RegExp) {
  for (let i = 0; i < lines.length; i++) {
    if (skip?.test(lines[i])) continue;
    if (patterns.some((p) => p.test(lines[i]))) return i + 1;
  }
  return null;
}

function findOne(lines: string[], name: string) {
  const { keyword, member } = declarationPatterns(name);
  return firstMatch(lines, keyword) ?? firstMatch(lines, member, NOT_CALL) ?? firstMatch(lines, [wordPattern(name)]);
}

function findSymbolLine(text: string, symbol: string): number | null {
  const parts = symbol.split(/[.:#]+/).filter(Boolean);
  if (!parts.length) return null;
  const lines = text.split('\n');
  for (const part of [...parts].reverse()) {
    const line = findOne(lines, part);
    if (line) return line;
  }
  return null;
}

export { findSymbolLine };
