import { readFileSync } from 'node:fs';
import { message } from './messages.mjs';
import { SkillError } from './http.mjs';

export const OPTION = Object.freeze({ value: 'value', flag: 'flag' });

const fail = (key, params = {}) => ({ error: message(key, params) });

export function parseArgs(argv, spec) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const kind = spec.options[arg.slice(2)];
    if (!kind) return fail('args.unknownOption', { option: arg });
    if (kind === OPTION.flag) {
      options[arg.slice(2)] = true;
      continue;
    }
    if (argv[i + 1] === undefined) return fail('args.missingValue', { option: arg });
    i += 1;
    options[arg.slice(2)] = argv[i];
  }
  const wanted = spec.positionals.length;
  const joined = spec.joinRest && positionals.length > wanted ? [...positionals.slice(0, wanted - 1), positionals.slice(wanted - 1).join(' ')] : positionals;
  if (joined.length !== wanted) return fail('args.positionals', { expected: spec.positionals.join(' ') || message('args.noArguments') });
  return { positionals: Object.fromEntries(spec.positionals.map((name, index) => [name, joined[index]])), options };
}

const BODY_SOURCES = Object.freeze({
  body: (value) => value,
  'body-file': (value) => readFileSync(value, 'utf8'),
});

export function readBody(options, { optional = false } = {}) {
  const given = Object.keys(BODY_SOURCES).filter((name) => options[name] !== undefined);
  if (!given.length && optional) return '';
  if (given.length !== 1) throw new SkillError(message('args.bodyRequired'));
  let text;
  try {
    text = BODY_SOURCES[given[0]](options[given[0]]);
  } catch (cause) {
    throw new SkillError(message('args.bodyUnreadable', { reason: cause.message }));
  }
  if (!text.trim() && !optional) throw new SkillError(message('args.bodyEmpty'));
  return text;
}

export function readLimit(options, fallback, max) {
  const raw = options.limit ?? String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new SkillError(message('args.badLimit', { max }));
  return value;
}
