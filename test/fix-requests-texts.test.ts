// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { INTENT_IDS, PRESET_IDS, copyTexts, fixPresets, presetText, suggestedIntent } from '../src/shared/lang/fix-requests';
import { LANGUAGES, languageCode } from '../src/shared/languages';

const textsOf = (code?: string) => Object.fromEntries(fixPresets(code).map((preset) => [preset.id, preset.text]));

describe('the predefined fix texts', () => {
  it('offers the same six choices, in order, in every language the map can be written in', () => {
    for (const name of LANGUAGES) {
      const code = languageCode(name);
      expect(fixPresets(code).map((preset) => preset.id), code).toEqual([...PRESET_IDS]);
      expect(fixPresets(code).every((preset) => preset.text.trim().length > 0), code).toBe(true);
    }
  });

  it('has a translated set for each non-English language, not a copy of the English one', () => {
    const english = textsOf('en');
    for (const name of LANGUAGES) {
      const code = languageCode(name);
      if (code === 'en') continue;
      const own = textsOf(code);
      for (const id of PRESET_IDS) expect(own[id], `${code}/${id}`).not.toBe(english[id]);
    }
  });

  it('answers a language by its code, ignoring case and region', () => {
    expect(textsOf('PL')).toEqual(textsOf('pl'));
    expect(textsOf('pl-PL')).toEqual(textsOf('pl'));
    expect(textsOf('pl').fix).toBe('Popraw to.');
  });

  it('falls back to English for an unknown or missing language', () => {
    expect(fixPresets('xx')).toEqual(fixPresets('en'));
    expect(fixPresets(undefined)).toEqual(fixPresets('en'));
    expect(fixPresets('')).toEqual(fixPresets('en'));
    expect(fixPresets('__proto__')).toEqual(fixPresets('en'));
  });

  it('falls back to the English text for one choice a language lacks or leaves blank', () => {
    const tables = {
      en: { text: { fix: 'Fix this.', test: 'Add a test.', rename: 'Rename.', simplify: 'Simplify.', explain: 'Explain.', remove: 'Remove.' } },
      zz: { text: { fix: 'Napraw', test: '   ', rename: 42 } },
    };

    const texts = Object.fromEntries(fixPresets('zz', tables).map((preset) => [preset.id, preset.text]));

    expect(texts).toEqual({ fix: 'Napraw', test: 'Add a test.', rename: 'Rename.', simplify: 'Simplify.', explain: 'Explain.', remove: 'Remove.' });
  });

  it('gives no choices at all when even the English set is missing', () => {
    expect(fixPresets('en', {})).toEqual([]);
  });

  it('suggests an intent for the text that asks for an explanation and none for the others', () => {
    expect(suggestedIntent('explain')).toBe('explain');
    for (const id of PRESET_IDS.filter((each) => each !== 'explain')) expect(suggestedIntent(id), id).toBeUndefined();
    expect(suggestedIntent(undefined)).toBeUndefined();
    expect(suggestedIntent('constructor')).toBeUndefined();
  });

  it('finds the text of a chosen preset, or nothing for an unknown one', () => {
    const presets = fixPresets('de');

    expect(presetText('remove', presets)).toBe('Das entfernen.');
    expect(presetText('nope', presets)).toBe('');
    expect(presetText(undefined, presets)).toBe('');
  });
});

describe('the intents and the wording of the copied text', () => {
  const codes = LANGUAGES.map((name) => languageCode(name));
  const wordsOf = (code: string) => {
    const texts = copyTexts(code);
    return [texts.header, texts.scope, texts.mixed, texts.intentWord, ...INTENT_IDS.flatMap((id) => [texts.intents[id].label, texts.intents[id].instruction])];
  };

  it('has every sentence, filled in, in every language the map can be written in', () => {
    for (const code of codes) {
      expect(wordsOf(code).every((word) => word.trim().length > 0), code).toBe(true);
    }
  });

  it('has its own wording in each non-English language, not a copy of the English one', () => {
    const english = copyTexts('en');
    for (const code of codes.filter((each) => each !== 'en')) {
      const own = copyTexts(code);
      expect(own.header, code).not.toBe(english.header);
      expect(own.scope, code).not.toBe(english.scope);
      expect(own.mixed, code).not.toBe(english.mixed);
      for (const id of INTENT_IDS) expect(own.intents[id].instruction, `${code}/${id}`).not.toBe(english.intents[id].instruction);
    }
  });

  it('keeps the word fix out of the explain and question instructions in English', () => {
    const { intents } = copyTexts('en');
    expect(`${intents.explain.label} ${intents.explain.instruction} ${intents.question.label} ${intents.question.instruction}`).not.toMatch(/\bfix\b/i);
  });
});
