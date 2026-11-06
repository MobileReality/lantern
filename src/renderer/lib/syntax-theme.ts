import theme from '../themes/lantern-dark.json';

interface SemanticStyle {
  foreground?: string;
  fontStyle?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

interface SemanticTheme {
  semanticHighlighting?: boolean;
  semanticTokenColors?: Record<string, string | SemanticStyle>;
}

function resolveSemanticStyle(source: SemanticTheme, type: string, modifiers: string[], language: string | null): SemanticStyle | null {
  if (!source.semanticHighlighting) return null;
  const resolved: SemanticStyle = {};
  const winners = new Map<keyof SemanticStyle, { score: number; order: number }>();
  Object.entries(source.semanticTokenColors ?? {}).forEach(([selector, value], order) => {
    const [tokenSelector, selectorLanguage] = selector.split(':');
    const [selectorType, ...selectorModifiers] = tokenSelector.split('.');
    if ((selectorType !== '*' && selectorType !== type) || (selectorLanguage && selectorLanguage !== language)) return;
    if (!selectorModifiers.every((modifier) => modifiers.includes(modifier))) return;
    const score = (selectorType === '*' ? 0 : 100) + selectorModifiers.length * 100 + (selectorLanguage ? 10 : 0);
    const style: SemanticStyle = typeof value === 'string' ? { foreground: value } : { ...value };
    if (style.fontStyle !== undefined) {
      const flags = new Set(style.fontStyle.split(/\s+/));
      style.bold = flags.has('bold'); style.italic = flags.has('italic'); style.underline = flags.has('underline'); style.strikethrough = flags.has('strikethrough');
      delete style.fontStyle;
    }
    for (const [property, setting] of Object.entries(style) as [keyof SemanticStyle, string | boolean][]) {
      const winner = winners.get(property);
      if (winner && (winner.score > score || (winner.score === score && winner.order > order))) continue;
      Object.assign(resolved, { [property]: setting }); winners.set(property, { score, order });
    }
  });
  return winners.size ? resolved : null;
}

const semanticStyle = (type: string, modifiers: string[], language: string | null) => resolveSemanticStyle(theme as SemanticTheme, type, modifiers, language);
const themeColors = theme.colors;

export { resolveSemanticStyle, semanticStyle, themeColors };
export type { SemanticStyle };
