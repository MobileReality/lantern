import { afterEach, describe, expect, it } from 'vitest';
import { checkCrossPlatform, crossPlatformCounts, crossPlatformFindings, MIN_GATEWAY_FILES } from '../skills/lantern-setup/scripts/cross-platform.mjs';
import { loadProject } from '../skills/lantern-setup/scripts/macro-stats.mjs';
import { plainSpec } from './helpers/lantern-vocab-fixtures';
import { type FixtureFile, type FixtureSpec, makeVocabProject, removeVocabProjects, runScript } from './helpers/lantern-vocab-project';

afterEach(removeVocabProjects);

const PLATFORMS = ['web web web/**', 'bot backend bot/**', 'api backend api/**', 'infra infra infra/**'];

const calling: FixtureFile[] = [
  { path: 'web/orders-client.ts', role: 'gateway', relations: ['= api/orders.controller.ts'] },
  { path: 'api/orders.controller.ts', role: 'handler' },
  { path: 'api/Dockerfile', role: 'infra' },
];
const isolatedBot: FixtureFile[] = [
  { path: 'bot/backend-client.ts', role: 'gateway', relations: ['> ext:chat-service'] },
  { path: 'bot/main.ts', role: 'entry' },
];
const deployed: FixtureFile = { path: 'infra/service.tf', role: 'infra', relations: ['> api/Dockerfile'] };
const undeployed: FixtureFile = { path: 'infra/service.tf', role: 'infra' };

const spec = (files: FixtureFile[], platforms: string[] = PLATFORMS): FixtureSpec => ({ files, platforms });
const findingsOf = (s: FixtureSpec) => crossPlatformFindings(loadProject(makeVocabProject(s)));
const kinds = (s: FixtureSpec) => findingsOf(s).map((f: { kind: string; platform: string }) => `${f.kind}:${f.platform}`);

describe('crossPlatformFindings: gateway platform with no relation to another platform', () => {
  it('fires when a peer platform has cross-platform relations and this one has none', () => {
    const [finding] = findingsOf(spec([...calling, ...isolatedBot, deployed]));
    expect(finding).toMatchObject({ kind: 'gateway-isolated', platform: 'bot', gateways: 1, calling: 0 });
    expect(finding.message).toContain('.lantern/platforms:2: [relations] platform "bot" has 1 gateway file(s) (bot/backend-client.ts) and 0 relations to another non-infra platform');
    expect(finding.message).toContain('while web (1), api (1) do');
    expect(finding.message).toContain('add the relation');
    expect(finding.message).toContain('or record why there are none');
  });

  it('does not fire once the gateway files relate to a handler of another platform', () => {
    const linked = isolatedBot.map((f) => (f.role === 'gateway' ? { ...f, relations: ['= api/orders.controller.ts'] } : f));
    expect(kinds(spec([...calling, ...linked, deployed]))).toEqual([]);
  });

  it('does not fire when no other non-infra platform has cross-platform relations either', () => {
    const silentWeb = [{ path: 'web/orders-client.ts', role: 'gateway', relations: ['> ext:chat-service'] }, { path: 'api/orders.controller.ts', role: 'handler' }];
    expect(kinds(spec([...silentWeb, ...isolatedBot, undeployed]))).toEqual(['infra-isolated:infra']);
    expect(findingsOf(spec([...silentWeb, ...isolatedBot]))).toEqual([]);
  });

  it('does not take a deploy relation from an infra platform as a peer that calls', () => {
    const files = [{ path: 'web/orders-client.ts', role: 'gateway', relations: ['> ext:chat-service'] }, { path: 'api/orders.controller.ts', role: 'handler' }, ...isolatedBot, deployed, { path: 'api/Dockerfile', role: 'infra' }];
    expect(kinds(spec(files))).toEqual([]);
  });

  it('still fires for a platform whose only relation is being deployed by infra', () => {
    const files = [...calling, ...isolatedBot, { path: 'bot/Dockerfile', role: 'infra' }, { path: 'infra/bot.tf', role: 'infra', relations: ['> bot/Dockerfile'] }, deployed];
    expect(kinds(spec(files))).toEqual(['gateway-isolated:bot']);
  });

  it('does not fire for a platform with no gateway file', () => {
    const botWithoutGateway = [{ path: 'bot/main.ts', role: 'entry' }, { path: 'bot/handlers.ts', role: 'handler' }];
    expect(kinds(spec([...calling, ...botWithoutGateway, deployed]))).toEqual([]);
    expect(MIN_GATEWAY_FILES).toBe(1);
  });

  it('ignores external systems, references and shared files as relations to another platform', () => {
    const lonely = [
      { path: 'bot/backend-client.ts', role: 'gateway', relations: ['< shared/types.ts', '> ext:chat-service'] },
      { path: 'bot/guide.md', role: 'skill', relations: ['@ api/orders.controller.ts'] },
      { path: 'shared/types.ts', role: 'schema' },
    ];
    expect(kinds(spec([...calling, ...lonely, deployed]))).toEqual(['gateway-isolated:bot']);
  });
});

describe('crossPlatformFindings: infra platform with no relation to another platform', () => {
  it('fires with the file and relation counts when no infra file points at a service', () => {
    const [finding] = findingsOf(spec([...calling, undeployed, { path: 'infra/queue.tf', role: 'infra' }]));
    expect(finding).toMatchObject({ kind: 'infra-isolated', platform: 'infra', files: 2, crossing: 0 });
    expect(finding.message).toContain('.lantern/platforms:4: [relations] infra platform "infra" has 2 file(s) and 0 relations to another platform');
    expect(finding.message).toContain("Dockerfile, start entry or manifest");
  });

  it('does not fire once one infra file points at the entry of a service', () => {
    expect(kinds(spec([...calling, deployed]))).toEqual([]);
  });

  it('counts a relation arriving at the infra platform too', () => {
    const files = [...calling, undeployed, { path: 'api/deploy.ts', role: 'script', relations: ['> infra/service.tf'] }];
    expect(kinds(spec(files))).toEqual([]);
  });

  it('does not fire for an infra platform with no mapped file', () => {
    expect(kinds(spec(calling))).toEqual([]);
  });
});

describe('crossPlatformFindings: repositories the check does not judge', () => {
  it('returns nothing without a platforms file', () => {
    const project = loadProject(makeVocabProject(plainSpec()));
    expect(project.platforms).toBeNull();
    expect(crossPlatformFindings(project)).toEqual([]);
    expect(checkCrossPlatform(project)).toEqual({ findings: [], warnings: [], summary: [] });
  });

  it('returns nothing for a single-platform repository, whatever its gateways do', () => {
    const files = [{ path: 'web/orders-client.ts', role: 'gateway' }, { path: 'web/page.ts', role: 'page' }];
    const project = loadProject(makeVocabProject(spec(files, ['web web web/**'])));
    expect(crossPlatformFindings(project)).toEqual([]);
    expect(crossPlatformCounts(project).get('web')).toMatchObject({ files: 2, crossing: 0 });
  });

  it('returns nothing when only one declared platform has mapped files', () => {
    const files = [{ path: 'bot/backend-client.ts', role: 'gateway' }];
    expect(kinds(spec(files))).toEqual([]);
  });
});

describe('the [relations] warnings in the scripts', () => {
  const validate = (root: string, ...flags: string[]) => runScript('validate.mjs', [root, ...flags]);

  it('validate.mjs prints them as warnings and exits 0, even with --strict', () => {
    const root = makeVocabProject(spec([...calling, ...isolatedBot, undeployed]));
    const result = validate(root, '--settled', '--strict');
    expect(result.status).toBe(0);
    expect(result.out).toContain('cross-platform: 2 finding(s) (warnings)');
    expect(result.out.split('\n').filter((l) => l.includes('[relations]'))).toHaveLength(2);
  });

  it('validate.mjs says OK on a repository whose platforms relate, and skips the check with --partial', () => {
    const linked = makeVocabProject(spec([...calling, deployed]));
    expect(validate(linked).out).toContain('cross-platform: OK');
    const partial = makeVocabProject(spec([...calling, ...isolatedBot, undeployed]));
    expect(validate(partial, '--partial').out).not.toContain('[relations]');
  });

  it('macro-eval.mjs warns on both checks and still exits 0', () => {
    const root = makeVocabProject(spec([...calling, ...isolatedBot, undeployed]));
    const result = runScript('macro-eval.mjs', [root]);
    expect(result.status).toBe(0);
    expect(result.out).toMatch(/^WARN cross-platform-gateway\s+bot 1 gateway file\(s\)/m);
    expect(result.out).toMatch(/^WARN cross-platform-infra\s+infra/m);
    expect(runScript('macro-eval.mjs', [makeVocabProject(spec([...calling, deployed]))]).out).toMatch(/^PASS cross-platform-gateway/m);
  });
});
