import { describe, expect, it } from 'vitest';
import {
  MODIFIED_TOKEN,
  countText,
  filterSettings,
  groupByCategory,
  parseQuery,
  settingTitle,
} from '../src/renderer/lib/settings-search';
import type { RegisteredSetting } from '../src/shared/settings-registry';

const GRAPH = { id: 'graph', title: 'Graph', order: 2 };
const EDITOR = { id: 'editor', title: 'Editor', order: 1 };

function setting(key: string, description: string, category = GRAPH, order?: number): RegisteredSetting<string> {
  return { key, category, schema: { type: 'boolean', default: true, description, order } };
}

const FOLD = setting('graph.foldFilesWhenZoomedOut', 'Show each folder as one tile when zoomed out.');
const LABELS = setting('graph.labels', 'Show file names next to nodes.');
const WRAP = setting('editor.wordWrap', 'Break long lines.', EDITOR);
const ALL = [FOLD, LABELS, WRAP];
const NONE = new Set<string>();

describe('settingTitle', () => {
  it('turns the last camelCase segment into a sentence', () => {
    expect(settingTitle('graph.foldFilesWhenZoomedOut')).toBe('Fold files when zoomed out');
  });

  it('capitalises a single-word key', () => {
    expect(settingTitle('graph.labels')).toBe('Labels');
    expect(settingTitle('theme')).toBe('Theme');
  });
});

describe('parseQuery', () => {
  it('reads @modified on its own', () => {
    expect(parseQuery(MODIFIED_TOKEN)).toEqual({ text: '', modifiedOnly: true });
  });

  it('separates @modified from the rest of the text', () => {
    expect(parseQuery('  fold @Modified tiles ')).toEqual({ text: 'fold tiles', modifiedOnly: true });
    expect(parseQuery('fold tiles')).toEqual({ text: 'fold tiles', modifiedOnly: false });
  });
});

describe('filterSettings', () => {
  const find = (text: string, modified = NONE, category: string | null = null) =>
    filterSettings(ALL, parseQuery(text), modified, category).map((s) => s.key);

  it('matches the key, the title and the description, ignoring case', () => {
    expect(find('editor.WORD')).toEqual(['editor.wordWrap']);
    expect(find('zoomed out')).toEqual(['graph.foldFilesWhenZoomedOut']);
    expect(find('file NAMES')).toEqual(['graph.labels']);
  });

  it('requires every word to match', () => {
    expect(find('show tile')).toEqual(['graph.foldFilesWhenZoomedOut']);
    expect(find('show nothing')).toEqual([]);
  });

  it('keeps only modified settings for @modified', () => {
    expect(find(MODIFIED_TOKEN, new Set(['graph.labels', 'editor.wordWrap']))).toEqual(['graph.labels', 'editor.wordWrap']);
    expect(find(`${MODIFIED_TOKEN} wrap`, new Set(['graph.labels', 'editor.wordWrap']))).toEqual(['editor.wordWrap']);
  });

  it('filters by category', () => {
    expect(find('', NONE, 'graph')).toEqual(['graph.foldFilesWhenZoomedOut', 'graph.labels']);
    expect(find('show', NONE, 'editor')).toEqual([]);
  });
});

describe('groupByCategory', () => {
  it('orders groups by category order, then settings by order and title', () => {
    const ordered = setting('graph.zoom', 'Zoom.', GRAPH, 1);
    const groups = groupByCategory([FOLD, LABELS, WRAP, ordered]);
    expect(groups.map((g) => g.category.id)).toEqual(['editor', 'graph']);
    expect(groups[1].settings.map((s) => s.key)).toEqual(['graph.zoom', 'graph.foldFilesWhenZoomedOut', 'graph.labels']);
  });
});

describe('countText', () => {
  it('names the number of settings found', () => {
    expect([0, 1, 2].map(countText)).toEqual(['No settings found', '1 setting', '2 settings']);
  });
});
