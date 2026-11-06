import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const PROVIDER_TABLE = 'src/shared/providers.ts';
const KINDS_TABLE = 'src/shared/auth-kinds.ts';
const LOGIC_FILES = [
  /^src\/shared\/auth[\w-]*\.ts$/,
  /^src\/main\/auth\/[\w-]+\.ts$/,
  /^src\/main\/lantern-host-origin\.ts$/,
  /^src\/renderer\/lib\/(auth-client|integrations-[\w-]+)\.ts$/,
  /^src\/renderer\/features\/integrations\.ts$/,
];

const STRING_LITERAL = /(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g;

type Pattern = [what: string, pattern: RegExp, codeOnly: boolean];

const PROVIDER_PATTERNS: Pattern[] = [
  ['a quoted provider id', /(['"`])(github|bitbucket|jira)\1/, false],
  ['a quoted provider host', /(['"`])(github\.com|bitbucket\.org|api\.github\.com|api\.bitbucket\.org)\1/, false],
  ['a provider display name in a string', /(['"`])(?:[^'"`\n]*\s)?(GitHub|Bitbucket|Jira)(?:\s[^'"`\n]*)?\1/, false],
  ['a provider id used as an object key', /(^|[\s{,(])(github|bitbucket|jira)\s*:/, true],
  ['a provider id used as a property', /(?<!\bPROVIDER)\.(github|bitbucket|jira)\b/, true],
];

const CHECK_FAILURES = 'unauthorized|forbidden|unavailable|network|timeout|malformed';

const KIND_PATTERNS: Pattern[] = [
  ['a quoted error code', /(['"`])(invalid-request|invalid-input|check-failed|storage-failed|unknown-profile|wrong-provider|provider-reports-expiry)\1/, false],
  ['a quoted check failure', /(['"`])(unauthorized|forbidden|malformed)\1/, false],
  ['a quoted connection state, credential source or persistence', /(['"`])(connected|connected-offline|project-file|memory-only)\1/, false],
  ['a check failure written into an error', new RegExp(`TokenCheckError\\(\\s*(['"\`])(${CHECK_FAILURES})\\1`), false],
  ['a check failure compared or assigned as a reason', new RegExp(`\\breason\\s*(?:===|!==|:)\\s*(['"\`])(${CHECK_FAILURES})\\1`), false],
  ['a check failure as a case label', new RegExp(`\\bcase\\s+(['"\`])(${CHECK_FAILURES})\\1`), false],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(relative);
    return entry.name.endsWith('.ts') ? [relative] : [];
  });
}

function hits(source: string, patterns: Pattern[]): { line: number; what: string; text: string }[] {
  return source.split('\n').flatMap((text, index) => {
    const code = text.replace(STRING_LITERAL, '""');
    return patterns.filter(([, pattern, codeOnly]) => pattern.test(codeOnly ? code : text)).map(([what]) => ({ line: index + 1, what, text: text.trim() }));
  });
}

const logicFiles = sourceFiles('src').filter((file) => LOGIC_FILES.some((pattern) => pattern.test(file)));

const offendersIn = (files: string[], patterns: Pattern[]) => files.flatMap((file) => hits(readFileSync(path.join(root, file), 'utf8'), patterns).map((hit) => `${file}:${hit.line} ${hit.what}: ${hit.text}`));

describe('no bare provider string in the integrations logic', () => {
  const files = logicFiles.filter((file) => file !== PROVIDER_TABLE);

  it('looks at the files that carry the logic', () => {
    expect(files).toEqual(expect.arrayContaining(['src/main/auth/token-check.ts', 'src/main/auth/spawn-env.ts', 'src/main/lantern-host-origin.ts', 'src/renderer/lib/integrations-format.ts', 'src/renderer/lib/integrations-help.ts', 'src/shared/auth-input.ts']));
    expect(files).not.toContain(PROVIDER_TABLE);
  });

  it('reads every provider id, name and host from the provider table', () => {
    expect(offendersIn(files, PROVIDER_PATTERNS)).toEqual([]);
  });

  it('would catch each kind of literal', () => {
    expect(hits("if (provider === 'github') return 1;", PROVIDER_PATTERNS)).toHaveLength(1);
    expect(hits('case "bitbucket":', PROVIDER_PATTERNS)).toHaveLength(1);
    expect(hits('const t = { github: 1 };', PROVIDER_PATTERNS)).toHaveLength(1);
    expect(hits('const t = { jira: 1 };', PROVIDER_PATTERNS)).toHaveLength(1);
    expect(hits('endpoints.github', PROVIDER_PATTERNS)).toHaveLength(1);
    expect(hits("const host = 'github.com';", PROVIDER_PATTERNS)).toHaveLength(1);
    expect(hits("const label = 'Open it in Jira';", PROVIDER_PATTERNS)).toHaveLength(1);
    expect(hits("const name = 'GitHub';", PROVIDER_PATTERNS)).toHaveLength(1);
  });

  it('does not take a header name, a URL or a message key for a provider', () => {
    expect(hits("headers: { 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json' }", PROVIDER_PATTERNS)).toEqual([]);
    expect(hits("const url = 'https://api.github.com/user';", PROVIDER_PATTERNS)).toEqual([]);
    expect(hits("msg('integrations.help.github.token')", PROVIDER_PATTERNS)).toEqual([]);
  });

  it('lets the table constants through', () => {
    expect(hits('if (provider === PROVIDER.github) return 1;', PROVIDER_PATTERNS)).toEqual([]);
    expect(hits('const t = { [PROVIDER.jira]: 1 };', PROVIDER_PATTERNS)).toEqual([]);
    expect(hits("msg('integrations.help.title')", PROVIDER_PATTERNS)).toEqual([]);
  });
});

describe('no bare error code or check failure in the integrations logic', () => {
  const files = logicFiles.filter((file) => file !== KINDS_TABLE);

  it('reads every error code and check failure from the shared kinds', () => {
    expect(offendersIn(files, KIND_PATTERNS)).toEqual([]);
  });

  it('would catch each kind of literal', () => {
    expect(hits("return { ok: false, error: 'invalid-request' };", KIND_PATTERNS)).toHaveLength(1);
    expect(hits("case 'forbidden':", KIND_PATTERNS)).not.toEqual([]);
    expect(hits('error: "provider-reports-expiry"', KIND_PATTERNS)).toHaveLength(1);
    expect(hits("const failure = err instanceof TokenCheckError ? err : new TokenCheckError('network');", KIND_PATTERNS)).toHaveLength(1);
    expect(hits("throw new TokenCheckError(`timeout`, 504);", KIND_PATTERNS)).toHaveLength(1);
    expect(hits("if (err.reason === 'unavailable') return;", KIND_PATTERNS)).toHaveLength(1);
    expect(hits("case 'network':", KIND_PATTERNS)).toHaveLength(1);
    expect(hits("if (profile.state !== 'connected') return;", KIND_PATTERNS)).toHaveLength(1);
    expect(hits("const winner = 'project-file';", KIND_PATTERNS)).toHaveLength(1);
  });

  it('lets the constants through', () => {
    expect(hits('return { ok: false, error: AUTH_ERROR.invalidRequest };', KIND_PATTERNS)).toEqual([]);
    expect(hits('case CHECK_FAILURE.forbidden:', KIND_PATTERNS)).toEqual([]);
    expect(hits('throw new TokenCheckError(CHECK_FAILURE.network);', KIND_PATTERNS)).toEqual([]);
    expect(hits('if (profile.state !== CONNECTION_STATE.connected) return;', KIND_PATTERNS)).toEqual([]);
    expect(hits('const failure = { reason: CHECK_FAILURE.timeout };', KIND_PATTERNS)).toEqual([]);
  });
});
