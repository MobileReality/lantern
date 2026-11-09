import { describe, expect, it } from 'vitest';
import { withoutTags } from '../website/src/lib/tags';

describe('withoutTags', () => {
  it.each([
    ['a tag pair', '<b>bold</b> text', 'bold text'],
    ['an attribute', '<span class="x">Install</span>', 'Install'],
    ['a tag inside a tag', '<scr<b>ipt>alert(1)', 'ipt>alert(1)'],
    ['a tag around a less-than sign', '<a<b>>x', '>x'],
    ['a less-than sign with no closing bracket', 'a < b', 'a < b'],
    ['an empty pair of brackets', 'a <> b', 'a <> b'],
    ['an empty pair followed by a tag', '<><b>c</b>', '<>c'],
    ['text with no markup', 'Plain heading', 'Plain heading'],
  ])('keeps the text of %s', (_label, markup, text) => {
    expect(withoutTags(markup)).toBe(text);
  });

  it.each(['<scr<b>ipt>alert(1)</scr</b>ipt>', '<<b>script>alert(1)<</b>/script>', '<><b></b>script>', '<<>script>', '<img src=x onerror=alert(1)'])(
    'leaves nothing that a second pass would strip from %s',
    (markup) => {
      const once = withoutTags(markup);
      expect(withoutTags(once)).toBe(once);
    },
  );
});
