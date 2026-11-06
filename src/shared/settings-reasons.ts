import type { SettingsNode } from './settings-schema';

export const DEFAULT_REASONS_REPLY_CHARS = 16_000;
export const DEFAULT_REASONS_DIFF_CHARS = 240_000;

export const REASONS_SETTINGS = {
  id: 'reasons',
  title: 'Generated reasons',
  properties: {
    'reasons.maxReplyCharacters': {
      type: 'number',
      default: DEFAULT_REASONS_REPLY_CHARS,
      minimum: 2_000,
      maximum: 120_000,
      order: 1,
      description:
        'Longest answer, in characters, accepted from Claude when it writes the reasons of a local comparison. Each file takes about 200, so this sets how many files one click can cover; the rest wait for the next click. A larger value costs more output tokens per run; the model stops at roughly 120000.',
    },
    'reasons.maxDiffCharacters': {
      type: 'number',
      default: DEFAULT_REASONS_DIFF_CHARS,
      minimum: 10_000,
      maximum: 600_000,
      order: 2,
      description:
        'Most characters of diff sent to Claude in one reasons run, across all files; each file is cut at 6000 characters around its changes. Files beyond this wait for the next click. A larger value costs more input tokens per run; the model reads at most roughly 600000.',
    },
  },
} satisfies SettingsNode;
