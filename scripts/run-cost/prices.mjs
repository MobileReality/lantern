const MILLION = 1_000_000;

export const USD_ESTIMATOR = 'list-price x transcript usage';

const SONNET_5 = { input: 2, output: 10, cacheRead: 0.2 };
const SONNET_4 = { input: 3, output: 15, cacheRead: 0.3 };
const OPUS_5_5 = { input: 4, output: 20, cacheRead: 0.2 };
const OPUS_5 = { input: 5, output: 25, cacheRead: 0.5 };
const OPUS_4 = OPUS_5;
const FABLE = { input: 10, output: 50, cacheRead: 0.25 };
const HAIKU_5 = { input: 0.1, output: 0.5, cacheRead: 0.01 };
const HAIKU_4 = { input: 1, output: 5, cacheRead: 0.1 };

export const PRICES_USD_PER_MTOK = {
  'claude-sonnet-5-5': SONNET_5,
  'claude-sonnet-5': SONNET_5,
  'claude-sonnet-4-6': SONNET_4,
  'claude-opus-5-5': OPUS_5_5,
  'claude-opus-5': OPUS_5,
  'claude-opus-4-8': OPUS_4,
  'claude-opus-4-7': OPUS_4,
  'claude-opus-4-6': OPUS_4,
  'claude-fable-5-1': FABLE,
  'claude-fable-5': FABLE,
  'claude-haiku-5-5': HAIKU_5,
  'claude-haiku-4-5': HAIKU_4,
};

const CACHE_WRITE_5M_FACTOR = 1.25;
const CACHE_WRITE_1H_FACTOR = 2;

export const priceFor = (model) => PRICES_USD_PER_MTOK[String(model ?? '').replace(/-\d{8}$/, '')] ?? null;

export function callUsd(model, usage) {
  const price = priceFor(model);
  if (!price) return null;
  const written = usage.cacheWrite;
  const written1h = Math.min(usage.cacheWrite1h ?? 0, written);
  const written5m = written - written1h;
  const usd =
    (usage.input * price.input +
      usage.output * price.output +
      usage.cacheRead * price.cacheRead +
      written5m * price.input * CACHE_WRITE_5M_FACTOR +
      written1h * price.input * CACHE_WRITE_1H_FACTOR) /
    MILLION;
  return usd;
}
