import { parseArgs } from './args.mjs';
import { createBitbucketApi } from './bitbucket-api.mjs';
import { COMMANDS } from './commands.mjs';
import { LANTERN_ACCESS, missingNames, readCredentials, secretsOf, sourceOf } from './credentials.mjs';
import { createGit } from './git.mjs';
import { SkillError } from './http.mjs';
import { completeEnv, reasonText } from './lantern-socket.mjs';
import { message } from './messages.mjs';
import { createRedactor } from './redact.mjs';

export const EXIT = Object.freeze({ ok: 0, failed: 1, usage: 2 });

const ALIASES = Object.freeze({ '--help': 'help', '-h': 'help' });

export async function run(argv, deps = {}) {
  const { env = process.env, fetch = globalThis.fetch, stdout = process.stdout, stderr = process.stderr, cwd = process.cwd(), lantern = {} } = deps;
  let redact = createRedactor(secretsOf(env));
  const print = (stream, lines) => stream.write(`${redact(lines.join('\n'))}\n`);
  const [first, ...rest] = argv;
  const name = ALIASES[first] ?? first;
  const spec = COMMANDS[name];
  if (!spec) {
    print(stderr, [message('cli.unknownCommand', { command: first ?? '' }), ...COMMANDS.help.run()]);
    return EXIT.usage;
  }
  const parsed = parseArgs(rest, spec);
  if (parsed.error) {
    print(stderr, [parsed.error, message(`usage.${name}`)]);
    return EXIT.usage;
  }
  const { env: credentialEnv, reason } = spec.needsCredentials ? await completeEnv(env, { ...LANTERN_ACCESS, cwd, ...lantern }) : { env, reason: null };
  redact = createRedactor(secretsOf(credentialEnv));
  const missing = spec.needsCredentials ? missingNames(credentialEnv) : [];
  if (missing.length) {
    print(stderr, [[message('credentials.missing', { names: missing.join(', ') }), reasonText(reason)].filter(Boolean).join(' ')]);
    return EXIT.failed;
  }
  try {
    const context = spec.needsCredentials ? { api: createBitbucketApi({ ...readCredentials(credentialEnv), fetch, redact }), git: deps.git ?? createGit(cwd), source: sourceOf(env, credentialEnv) } : {};
    print(stdout, await spec.run({ ...context, cwd, env, ...parsed }));
    return EXIT.ok;
  } catch (error) {
    print(stderr, [error instanceof SkillError ? error.message : message('cli.failed', { reason: error?.message ?? error })]);
    return EXIT.failed;
  }
}
